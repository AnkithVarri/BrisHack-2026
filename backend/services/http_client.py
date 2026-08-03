import asyncio
import hashlib
import json
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
INITIAL_BACKOFF = 1.0  # seconds
BACKOFF_MULTIPLIER = 2.0

# ---------------------------------------------------------------------------
# Open-Meteo customer API key — injected automatically into any request
# whose URL contains "open-meteo.com".
# ---------------------------------------------------------------------------
OPEN_METEO_API_KEY = os.getenv("OPEN_METEO_API_KEY", "")

# ---------------------------------------------------------------------------
# In-memory response cache — avoids duplicate fetches for the same
# (url, params) combination within a short window.
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes


def _cache_key(url: str, params: dict) -> str:
    raw = f"{url}|{json.dumps(params, sort_keys=True, default=str)}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _get_cached(key: str) -> dict | None:
    if key in _cache:
        ts, data = _cache[key]
        if time.monotonic() - ts < CACHE_TTL_SECONDS:
            return data
        del _cache[key]
    return None


def _set_cached(key: str, data: dict) -> None:
    _cache[key] = (time.monotonic(), data)
    # Prune stale entries when cache grows large
    if len(_cache) > 200:
        now = time.monotonic()
        stale = [k for k, (ts, _) in _cache.items() if now - ts >= CACHE_TTL_SECONDS]
        for k in stale:
            del _cache[k]


async def fetch_with_retry(
    url: str,
    params: dict,
    timeout: float = 30.0,
    max_retries: int = MAX_RETRIES,
) -> dict:
    """
    GET request with:
    - In-memory response cache (same URL + params returns cached result within TTL)
    - Automatic retry on rate-limits (429), server errors (5xx), and timeouts
    - Exponential backoff, respects Retry-After header
    """
    # Auto-inject Open-Meteo API key for customer endpoints
    if OPEN_METEO_API_KEY and "open-meteo.com" in url:
        params = {**params, "apikey": OPEN_METEO_API_KEY}

    key = _cache_key(url, params)
    cached = _get_cached(key)
    if cached is not None:
        logger.debug("Cache hit for %s", url)
        return cached

    backoff = INITIAL_BACKOFF

    for attempt in range(max_retries + 1):
        async with httpx.AsyncClient(follow_redirects=True) as client:
            try:
                response = await client.get(url, params=params, timeout=timeout)

                # Success
                if response.status_code == 200:
                    data = response.json()
                    _set_cached(key, data)
                    return data

                # Rate limited
                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        wait = float(retry_after)
                    else:
                        wait = backoff

                    if attempt < max_retries:
                        logger.warning(
                            "Rate limited (429) on %s, retrying in %.1fs (attempt %d/%d)",
                            url, wait, attempt + 1, max_retries,
                        )
                        await asyncio.sleep(wait)
                        backoff *= BACKOFF_MULTIPLIER
                        continue
                    else:
                        logger.error("Rate limited (429) on %s, max retries exceeded", url)
                        response.raise_for_status()

                # Server error (5xx) — retry
                if response.status_code >= 500:
                    if attempt < max_retries:
                        logger.warning(
                            "Server error (%d) on %s, retrying in %.1fs (attempt %d/%d)",
                            response.status_code, url, backoff, attempt + 1, max_retries,
                        )
                        await asyncio.sleep(backoff)
                        backoff *= BACKOFF_MULTIPLIER
                        continue
                    else:
                        logger.error("Server error (%d) on %s, max retries exceeded", response.status_code, url)
                        response.raise_for_status()

                # Other errors (4xx) — don't retry, raise immediately
                response.raise_for_status()

            except httpx.TimeoutException:
                if attempt < max_retries:
                    logger.warning(
                        "Timeout on %s, retrying in %.1fs (attempt %d/%d)",
                        url, backoff, attempt + 1, max_retries,
                    )
                    await asyncio.sleep(backoff)
                    backoff *= BACKOFF_MULTIPLIER
                    continue
                else:
                    logger.error("Timeout on %s, max retries exceeded", url)
                    raise

            except httpx.ConnectError:
                if attempt < max_retries:
                    logger.warning(
                        "Connection error on %s, retrying in %.1fs (attempt %d/%d)",
                        url, backoff, attempt + 1, max_retries,
                    )
                    await asyncio.sleep(backoff)
                    backoff *= BACKOFF_MULTIPLIER
                    continue
                else:
                    logger.error("Connection error on %s, max retries exceeded", url)
                    raise

    # Should never reach here, but just in case
    raise httpx.HTTPError(f"Failed after {max_retries} retries: {url}")


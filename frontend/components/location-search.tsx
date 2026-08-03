"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { MapPin } from "lucide-react"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"

interface GeocoderFeature {
  id: string
  place_name: string
  center: [number, number]
}

interface LocationSearchProps {
  accessToken: string
  onSelect: (center: [number, number], placeName: string) => void
  onLoadingChange?: (isLoading: boolean) => void
}

export function LocationSearch({ accessToken, onSelect, onLoadingChange }: LocationSearchProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GeocoderFeature[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchLocations = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([])
        return
      }

      onLoadingChange?.(true)
      try {
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
            searchQuery
          )}.json?access_token=${accessToken}&limit=5`
        )
        const data = await response.json()
        setResults(data.features || [])
      } catch (error) {
        console.error("Geocoding error:", error)
        setResults([])
      } finally {
        onLoadingChange?.(false)
      }
    },
    [accessToken, onLoadingChange]
  )

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      searchLocations(query)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, searchLocations])

  const handleSelect = (feature: GeocoderFeature) => {
    onSelect(feature.center, feature.place_name)
    setQuery(feature.place_name)
    setIsOpen(false)
    setResults([])
  }

  return (
    <div className="relative w-80">
      <Command className="rounded-2xl border shadow-lg bg-background overflow-hidden" shouldFilter={false}>
        <CommandInput
          placeholder="Search for a location..."
          value={query}
          onValueChange={(value) => {
            setQuery(value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
        />
        {isOpen && (query.trim() || results.length > 0) && (
          <CommandList>
            {query.trim() && results.length === 0 && (
              <CommandEmpty>No locations found.</CommandEmpty>
            )}
            {results.length > 0 && (
              <CommandGroup heading="Locations">
                {results.map((feature) => (
                  <CommandItem
                    key={feature.id}
                    value={feature.id}
                    onSelect={() => handleSelect(feature)}
                    className="cursor-pointer"
                  >
                    <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{feature.place_name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  )
}

'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import Link from 'next/link'
import { STAGE_COLOR, STAGE_LABEL, type Stage, type Yard } from '@/lib/types'

export default function YardMap({
  yards,
  center,
}: {
  yards: Yard[]
  center: { lat: number; lng: number }
}) {
  const pins = yards.filter((y) => y.lat != null && y.lng != null)

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={9}
      scrollWheelZoom
      style={{ height: '55vh', width: '100%', borderRadius: '0.75rem' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pins.map((y) => (
        <CircleMarker
          key={y.id}
          center={[y.lat!, y.lng!]}
          radius={8}
          pathOptions={{
            color: '#0f172a',
            weight: 1,
            fillColor: STAGE_COLOR[y.stage as Stage] ?? '#64748b',
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <div style={{ minWidth: 180 }}>
              <strong>{y.name}</strong>
              <div style={{ fontSize: 12, color: '#475569' }}>
                {[y.address, y.city].filter(Boolean).join(', ')}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {STAGE_LABEL[y.stage as Stage] ?? y.stage}
                {y.published_listing_count != null &&
                  ` · ${y.published_listing_count.toLocaleString()} listed`}
              </div>
              {y.phone && (
                <a
                  href={`tel:${y.phone.replace(/[^\d+]/g, '')}`}
                  style={{
                    display: 'block',
                    marginTop: 8,
                    background: '#059669',
                    color: '#fff',
                    padding: '8px',
                    borderRadius: 8,
                    textAlign: 'center',
                    fontWeight: 700,
                  }}
                >
                  Call {y.phone}
                </a>
              )}
              <Link
                href={`/yards/${y.id}`}
                style={{
                  display: 'block',
                  marginTop: 6,
                  background: '#1e293b',
                  color: '#fff',
                  padding: '8px',
                  borderRadius: 8,
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              >
                Start call
              </Link>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}

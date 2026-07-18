import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import Point from 'ol/geom/Point.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import OSM from 'ol/source/OSM.js';
import VectorSource from 'ol/source/Vector.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import 'ol/ol.css';

export interface IncidentPosition {
  readonly latitude: number;
  readonly longitude: number;
}

export function AdminIncidentPlacementMap({ value, onChange }: {
  readonly value: IncidentPosition | null;
  readonly onChange: (position: IncidentPosition) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const marker = useRef<Feature<Point> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!container.current) return;
    const markerFeature = new Feature<Point>();
    markerFeature.setStyle(new Style({
      image: new CircleStyle({
        radius: 9,
        fill: new Fill({ color: '#f04b16' }),
        stroke: new Stroke({ color: '#ffffff', width: 3 }),
      }),
    }));
    marker.current = markerFeature;
    const instance = new Map({
      target: container.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({ source: new VectorSource({ features: [markerFeature] }) }),
      ],
      view: new View({ center: fromLonLat([2.2, 46.4]), zoom: 6, minZoom: 3, maxZoom: 19 }),
    });
    instance.on('singleclick', (event) => {
      const [longitude, latitude] = toLonLat(event.coordinate);
      onChangeRef.current({ longitude, latitude });
    });
    map.current = instance;
    return () => {
      instance.setTarget(undefined);
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!marker.current || !map.current || !value) return;
    const coordinate = fromLonLat([value.longitude, value.latitude]);
    marker.current.setGeometry(new Point(coordinate));
    map.current.getView().animate({ center: coordinate, zoom: Math.max(map.current.getView().getZoom() ?? 6, 13), duration: 180 });
  }, [value]);

  return (
    <div className="admin-incident-placement-map">
      <div ref={container} className="admin-incident-placement-map__canvas" aria-label="Carte de placement du nouvel incident" />
      <p>Cliquez sur le site connu. Vous pourrez déplacer le point tant que la fiche n’est pas créée.</p>
    </div>
  );
}

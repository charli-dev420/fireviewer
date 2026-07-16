using System;
using System.Collections.Generic;

namespace FireViewer.SpatialTiles
{
    public readonly struct FwFocusZone
    {
        public FwFocusZone(string id, string label, double easting, double northing, double elevation)
        {
            Id = id;
            Label = label;
            Easting = easting;
            Northing = northing;
            Elevation = elevation;
        }

        public string Id { get; }
        public string Label { get; }
        public double Easting { get; }
        public double Northing { get; }
        public double Elevation { get; }
    }

    public static class FwKnownFocusZones
    {
        // Elevations are sampled from the catalog's 5 m global MNT at each
        // focus coordinate.  A correct vertical target is essential in the
        // near band: looking at the local-frame zero would aim below ground.
        public static readonly FwFocusZone Montmaur = new("montmaur", "Montmaur-en-Diois", 888576.5d, 6400287.5d, 520.897d);
        public static readonly FwFocusZone Barsac = new("barsac", "Barsac", 881380.5d, 6406209.5d, 386.399d);
        public static readonly FwFocusZone Ausson = new("ausson", "Ausson", 889056d, 6405524d, 448.392d);

        public static bool TryGet(string id, out FwFocusZone zone)
        {
            if (string.Equals(id, Montmaur.Id, StringComparison.OrdinalIgnoreCase)) { zone = Montmaur; return true; }
            if (string.Equals(id, Barsac.Id, StringComparison.OrdinalIgnoreCase)) { zone = Barsac; return true; }
            if (string.Equals(id, Ausson.Id, StringComparison.OrdinalIgnoreCase)) { zone = Ausson; return true; }
            zone = default;
            return false;
        }
    }

    public sealed class FwTileSelectionPlan
    {
        internal FwTileSelectionPlan(FwCatalogTile[] tiles, string blockingError)
        {
            Tiles = tiles;
            BlockingError = blockingError ?? string.Empty;
        }

        public FwCatalogTile[] Tiles { get; }
        public string BlockingError { get; }
        public bool IsBlocked => BlockingError.Length > 0;
    }

    public static class FwSpatialLodPlanner
    {
        public const int AbsoluteMaximumResidentTiles = 16;
        public const double NearMaximumMetres = 750d;
        public const double MidMaximumMetres = 3000d;

        public static string ClassifyBand(double viewDistanceMetres)
        {
            if (!IsFinite(viewDistanceMetres) || viewDistanceMetres < 0d) throw new ArgumentException("View distance is invalid.");
            if (viewDistanceMetres <= NearMaximumMetres) return "near";
            if (viewDistanceMetres <= MidMaximumMetres) return "mid";
            return "far";
        }

        public static FwTileSelectionPlan Select(FwRemoteCatalog catalog, double easting, double northing, int runtimeBudget)
            => Select(catalog, easting, northing, 0d, runtimeBudget);

        public static FwTileSelectionPlan Select(FwRemoteCatalog catalog, double easting, double northing, double viewDistanceMetres, int runtimeBudget)
        {
            if (catalog?.lod_policy?.detail == null) throw new ArgumentException("Catalog detail LOD is missing.");
            if (!IsFinite(easting) || !IsFinite(northing)) throw new ArgumentException("Lambert-93 focus is not finite.");
            int budget = Math.Min(AbsoluteMaximumResidentTiles, Math.Min(runtimeBudget, catalog.lod_policy.detail.maximum_resident_tile_count));
            if (budget <= 0) return new FwTileSelectionPlan(Array.Empty<FwCatalogTile>(), "Resident tile budget is zero.");
            if (string.Equals(ClassifyBand(viewDistanceMetres), "far", StringComparison.Ordinal))
                return new FwTileSelectionPlan(Array.Empty<FwCatalogTile>(), string.Empty);
            double radiusSquared = catalog.lod_policy.detail.preload_radius_m * catalog.lod_policy.detail.preload_radius_m;
            var candidates = new List<Candidate>();
            foreach (FwCatalogTile tile in catalog.tiles)
            {
                double distance = tile.SquaredDistance(easting, northing);
                if (distance <= radiusSquared) candidates.Add(new Candidate(tile, distance));
            }
            candidates.Sort(Candidate.Compare);
            if (candidates.Count > budget)
                return new FwTileSelectionPlan(Array.Empty<FwCatalogTile>(), $"Complete detail neighbourhood requires {candidates.Count} tiles, budget is {budget}; far fallback retained.");
            var selected = new FwCatalogTile[candidates.Count];
            for (int index = 0; index < selected.Length; index++) selected[index] = candidates[index].Tile;
            return new FwTileSelectionPlan(selected, string.Empty);
        }

        private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

        private readonly struct Candidate
        {
            public Candidate(FwCatalogTile tile, double distance) { Tile = tile; Distance = distance; }
            public FwCatalogTile Tile { get; }
            private double Distance { get; }
            public static int Compare(Candidate left, Candidate right)
            {
                int byDistance = left.Distance.CompareTo(right.Distance);
                return byDistance != 0 ? byDistance : string.Compare(left.Tile.id, right.Tile.id, StringComparison.Ordinal);
            }
        }
    }

    public sealed class FwAtomicPublicationState
    {
        private readonly HashSet<string> desired = new(StringComparer.Ordinal);
        private readonly HashSet<string> staged = new(StringComparer.Ordinal);

        public bool FarVisible { get; private set; } = true;
        public bool DetailVisible { get; private set; }
        public string Failure { get; private set; } = string.Empty;

        public void Begin(IEnumerable<string> tileIds)
        {
            desired.Clear(); staged.Clear(); Failure = string.Empty;
            foreach (string id in tileIds) desired.Add(id);
            FarVisible = true; DetailVisible = false;
        }

        public bool Stage(string tileId)
        {
            if (!desired.Contains(tileId) || Failure.Length > 0) return false;
            staged.Add(tileId);
            return true;
        }

        public bool TryPublish()
        {
            if (Failure.Length > 0 || desired.Count == 0 || staged.Count != desired.Count) return false;
            foreach (string id in desired) if (!staged.Contains(id)) return false;
            // The far context is global and must remain behind the local detail.
            FarVisible = true; DetailVisible = true; return true;
        }

        public void Fail(string reason)
        {
            Failure = string.IsNullOrWhiteSpace(reason) ? "Detail tile load failed." : reason;
            staged.Clear(); FarVisible = true; DetailVisible = false;
        }
    }
}

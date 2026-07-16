using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace FireViewer.SpatialTiles
{
    public sealed class FwTileUnityBuilder : IDisposable
    {
        private const float TreeGroundClearanceMetres = 0.02f;
        private readonly Shader surfaceShader;
        private readonly Shader colourShader;
        private readonly List<UnityEngine.Object> ownedAssets = new();

        public FwTileUnityBuilder()
        {
            surfaceShader = Resources.Load<Shader>("FireViewerOperationalTerrain") ??
                Shader.Find("FireViewer/Operational Terrain") ?? Shader.Find("Unlit/Texture");
            colourShader = Resources.Load<Shader>("FireViewerOperationalFeature") ??
                Shader.Find("FireViewer/Operational Feature") ?? Shader.Find("Standard") ?? Shader.Find("Unlit/Color");
            if (surfaceShader == null || colourShader == null)
                throw new InvalidOperationException("FireViewer operational shaders are unavailable.");
        }

        public GameObject Build(FwTileGeometry geometry, Texture2D orthophoto, Transform parent, float unityUnitsPerMetre = 1f)
        {
            if (geometry?.Terrain == null || orthophoto == null || unityUnitsPerMetre <= 0f)
                throw new ArgumentException("Tile geometry, imagery or Unity scale is invalid.");

            bool isFar = string.Equals(geometry.Terrain.Name, "far-terrain", StringComparison.Ordinal);
            var root = new GameObject($"FireViewer tile — {geometry.TileId}");
            root.transform.SetParent(parent, false);
            root.transform.localScale = Vector3.one * unityUnitsPerMetre;

            BuildMeshObject("Terrain", geometry.Terrain, root.transform, TerrainMaterial(orthophoto, isFar), 0f, ShadowCastingMode.Off, true);

            Material buildings = ColourMaterial("Buildings — neutral mineral", new Color(0.39f, 0.37f, 0.34f), 2020);
            BuildSection("Buildings", geometry.Buildings, root.transform, _ => buildings, ShadowCastingMode.On, true);

            Material roadCarriageway = ColourMaterial("Road — carriageway", new Color(0.30f, 0.31f, 0.30f), 2060);
            Material roadShoulder = ColourMaterial("Road — shoulder", new Color(0.38f, 0.36f, 0.32f), 2050);
            Material roadMarking = ColourMaterial("Road — marking", new Color(0.76f, 0.72f, 0.57f), 2070);
            BuildSection(
                "Roads",
                geometry.Roads,
                root.transform,
                mesh => RoadMaterial(mesh.Name, roadCarriageway, roadShoulder, roadMarking),
                ShadowCastingMode.Off,
                false);

            Material waterSegments = ColourMaterial("Water — channel", new Color(0.12f, 0.35f, 0.45f), 2045);
            Material waterSurfaces = ColourMaterial("Water — surface", new Color(0.10f, 0.30f, 0.40f), 2040);
            BuildSection(
                "Water",
                geometry.Water,
                root.transform,
                mesh => mesh.Name.IndexOf("surface", StringComparison.OrdinalIgnoreCase) >= 0 ? waterSurfaces : waterSegments,
                ShadowCastingMode.Off,
                false);

            if (geometry.Trees.Length > 0)
            {
                FwTreeInstance[] visibleTrees = PrepareTrees(geometry, out int maskedTrees, out int groundedTrees);
                if (visibleTrees.Length > 0)
                {
                    var trees = new GameObject("Trees — detected crowns, operational LOD");
                    trees.transform.SetParent(root.transform, false);
                    trees.AddComponent<FwInstancedTreeRenderer>().Configure(visibleTrees, colourShader);
                }
                if (maskedTrees > 0 || groundedTrees > 0)
                    Debug.Log(
                        $"FIREVIEWER_TREE_RENDER_PREPARED tile={geometry.TileId} source={geometry.Trees.Length} " +
                        $"visible={visibleTrees.Length} maskedRoadOrWater={maskedTrees} grounded={groundedTrees}");
            }
            return root;
        }

        public void Dispose()
        {
            foreach (UnityEngine.Object asset in ownedAssets)
                if (asset != null) DestroyOwned(asset);
            ownedAssets.Clear();
        }

        private FwTreeInstance[] PrepareTrees(FwTileGeometry geometry, out int maskedTrees, out int groundedTrees)
        {
            var mask = new FwHorizontalFootprintMask(16f);
            mask.Add(geometry.Roads);
            mask.Add(geometry.Water);
            var terrain = new FwRegularTerrainSampler(geometry.Terrain);
            var output = new List<FwTreeInstance>(geometry.Trees.Length);
            maskedTrees = 0;
            groundedTrees = 0;

            foreach (FwTreeInstance source in geometry.Trees)
            {
                if (mask.Contains(source.Position.X, source.Position.Z))
                {
                    maskedTrees++;
                    continue;
                }

                FwPoint3 position = source.Position;
                if (terrain.TrySample(position.X, position.Z, out float ground))
                {
                    float anchored = ground + TreeGroundClearanceMetres;
                    if (Mathf.Abs(position.Y - anchored) > 0.02f) groundedTrees++;
                    position = new FwPoint3(position.X, anchored, position.Z);
                }
                output.Add(new FwTreeInstance(position, source.Height, source.CrownDiameter, source.Variant, source.RotationDegrees));
            }
            return output.ToArray();
        }

        private void BuildSection(
            string name,
            FwMeshData[] meshes,
            Transform parent,
            Func<FwMeshData, Material> resolveMaterial,
            ShadowCastingMode shadows,
            bool receiveShadows)
        {
            if (meshes == null || meshes.Length == 0) return;
            var section = new GameObject(name);
            section.transform.SetParent(parent, false);
            foreach (FwMeshData mesh in meshes)
                BuildMeshObject(mesh.Name, mesh, section.transform, resolveMaterial(mesh), 0f, shadows, receiveShadows);
        }

        private void BuildMeshObject(
            string name,
            FwMeshData source,
            Transform parent,
            Material material,
            float verticalBiasMetres,
            ShadowCastingMode shadows,
            bool receiveShadows)
        {
            if (source.Vertices == null || source.Vertices.Length == 0 || source.Triangles == null || source.Triangles.Length == 0) return;
            var gameObject = new GameObject(string.IsNullOrWhiteSpace(name) ? "Mesh" : name);
            gameObject.transform.SetParent(parent, false);
            var mesh = new Mesh
            {
                name = $"{gameObject.name} mesh",
                indexFormat = source.Vertices.Length > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16,
            };
            var vertices = new Vector3[source.Vertices.Length];
            for (int index = 0; index < vertices.Length; index++)
                vertices[index] = new Vector3(source.Vertices[index].X, source.Vertices[index].Y + verticalBiasMetres, source.Vertices[index].Z);
            mesh.vertices = vertices;
            mesh.triangles = source.Triangles;
            if (source.Uv != null && source.Uv.Length == source.Vertices.Length)
            {
                var uv = new Vector2[source.Uv.Length];
                for (int index = 0; index < uv.Length; index++) uv[index] = new Vector2(source.Uv[index].X, source.Uv[index].Y);
                mesh.uv = uv;
            }
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(true);
            gameObject.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = gameObject.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = shadows;
            renderer.receiveShadows = receiveShadows;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            ownedAssets.Add(mesh);
        }

        private Material TerrainMaterial(Texture texture, bool isFar)
        {
            var material = new Material(surfaceShader) { name = isFar ? "FireViewer terrain FAR" : "FireViewer terrain DETAIL" };
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", texture);
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_Tint")) material.SetColor("_Tint", Color.white);
            if (material.HasProperty("_Color")) material.SetColor("_Color", Color.white);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            if (material.HasProperty("_ClipDetailFootprints")) material.SetFloat("_ClipDetailFootprints", isFar ? 1f : 0f);
            material.renderQueue = isFar ? 1900 : 1950;
            ownedAssets.Add(material);
            return material;
        }

        private Material ColourMaterial(string name, Color colour, int renderQueue)
        {
            var material = new Material(colourShader) { name = name, enableInstancing = true, renderQueue = renderQueue };
            if (material.HasProperty("_Color")) material.SetColor("_Color", colour);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.04f);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.04f);
            if (material.HasProperty("_SpecColor")) material.SetColor("_SpecColor", Color.black);
            ownedAssets.Add(material);
            return material;
        }

        private static Material RoadMaterial(string name, Material carriageway, Material shoulder, Material marking)
        {
            if (name.IndexOf("mark", StringComparison.OrdinalIgnoreCase) >= 0 ||
                name.IndexOf("center", StringComparison.OrdinalIgnoreCase) >= 0)
                return marking;
            return name.IndexOf("shoulder", StringComparison.OrdinalIgnoreCase) >= 0 ? shoulder : carriageway;
        }

        private static void DestroyOwned(UnityEngine.Object value)
        {
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }

    internal sealed class FwRegularTerrainSampler
    {
        private readonly FwPoint3[] vertices;
        private readonly int rows;
        private readonly int columns;
        private readonly float west;
        private readonly float north;
        private readonly float spacingX;
        private readonly float spacingZ;
        private readonly bool valid;

        public FwRegularTerrainSampler(FwMeshData terrain)
        {
            vertices = terrain?.Vertices ?? Array.Empty<FwPoint3>();
            if (vertices.Length < 4) return;
            north = vertices[0].Z;
            columns = 1;
            while (columns < vertices.Length && Mathf.Abs(vertices[columns].Z - north) < 0.0001f) columns++;
            if (columns < 2 || vertices.Length % columns != 0) return;
            rows = vertices.Length / columns;
            if (rows < 2) return;
            west = vertices[0].X;
            spacingX = vertices[1].X - west;
            spacingZ = north - vertices[columns].Z;
            valid = spacingX > 0f && spacingZ > 0f;
        }

        public bool TrySample(float east, float northing, out float height)
        {
            height = 0f;
            if (!valid) return false;
            float gridX = (east - west) / spacingX;
            float gridZ = (north - northing) / spacingZ;
            if (gridX < -0.001f || gridZ < -0.001f || gridX > columns - 1 + 0.001f || gridZ > rows - 1 + 0.001f)
                return false;
            int column = Mathf.Clamp(Mathf.FloorToInt(gridX), 0, columns - 2);
            int row = Mathf.Clamp(Mathf.FloorToInt(gridZ), 0, rows - 2);
            float x = Mathf.Clamp01(gridX - column);
            float z = Mathf.Clamp01(gridZ - row);
            float nw = vertices[row * columns + column].Y;
            float ne = vertices[row * columns + column + 1].Y;
            float sw = vertices[(row + 1) * columns + column].Y;
            float se = vertices[(row + 1) * columns + column + 1].Y;
            height = x >= z
                ? nw + x * (ne - nw) + z * (se - ne)
                : nw + x * (se - sw) + z * (sw - nw);
            return true;
        }
    }

    internal sealed class FwHorizontalFootprintMask
    {
        private readonly float cellSize;
        private readonly Dictionary<long, List<Triangle>> cells = new();

        public FwHorizontalFootprintMask(float cellSizeMetres)
        {
            cellSize = Mathf.Max(1f, cellSizeMetres);
        }

        public void Add(FwMeshData[] meshes)
        {
            if (meshes == null) return;
            foreach (FwMeshData mesh in meshes)
            {
                if (mesh?.Vertices == null || mesh.Triangles == null) continue;
                for (int index = 0; index + 2 < mesh.Triangles.Length; index += 3)
                {
                    FwPoint3 pa = mesh.Vertices[mesh.Triangles[index]];
                    FwPoint3 pb = mesh.Vertices[mesh.Triangles[index + 1]];
                    FwPoint3 pc = mesh.Vertices[mesh.Triangles[index + 2]];
                    var triangle = new Triangle(pa.X, pa.Z, pb.X, pb.Z, pc.X, pc.Z);
                    if (triangle.IsDegenerate) continue;
                    int minimumX = Cell(triangle.MinimumX);
                    int maximumX = Cell(triangle.MaximumX);
                    int minimumZ = Cell(triangle.MinimumZ);
                    int maximumZ = Cell(triangle.MaximumZ);
                    for (int x = minimumX; x <= maximumX; x++)
                    for (int z = minimumZ; z <= maximumZ; z++)
                    {
                        long key = Key(x, z);
                        if (!cells.TryGetValue(key, out List<Triangle> bucket))
                        {
                            bucket = new List<Triangle>();
                            cells.Add(key, bucket);
                        }
                        bucket.Add(triangle);
                    }
                }
            }
        }

        public bool Contains(float x, float z)
        {
            if (!cells.TryGetValue(Key(Cell(x), Cell(z)), out List<Triangle> bucket)) return false;
            foreach (Triangle triangle in bucket)
                if (triangle.Contains(x, z)) return true;
            return false;
        }

        private int Cell(float value) => Mathf.FloorToInt(value / cellSize);
        private static long Key(int x, int z) => ((long)x << 32) ^ (uint)z;

        private readonly struct Triangle
        {
            private readonly float ax;
            private readonly float az;
            private readonly float bx;
            private readonly float bz;
            private readonly float cx;
            private readonly float cz;
            private readonly float denominator;

            public Triangle(float ax, float az, float bx, float bz, float cx, float cz)
            {
                this.ax = ax; this.az = az;
                this.bx = bx; this.bz = bz;
                this.cx = cx; this.cz = cz;
                denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
                MinimumX = Mathf.Min(ax, Mathf.Min(bx, cx));
                MaximumX = Mathf.Max(ax, Mathf.Max(bx, cx));
                MinimumZ = Mathf.Min(az, Mathf.Min(bz, cz));
                MaximumZ = Mathf.Max(az, Mathf.Max(bz, cz));
            }

            public float MinimumX { get; }
            public float MaximumX { get; }
            public float MinimumZ { get; }
            public float MaximumZ { get; }
            public bool IsDegenerate => Mathf.Abs(denominator) < 0.000001f;

            public bool Contains(float x, float z)
            {
                float first = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
                float second = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
                float third = 1f - first - second;
                const float tolerance = -0.0001f;
                return first >= tolerance && second >= tolerance && third >= tolerance;
            }
        }
    }

    [DisallowMultipleComponent]
    internal sealed class FwInstancedTreeRenderer : MonoBehaviour
    {
        private const int MaximumBatch = 1023;
        private const int VariantCount = 6;
        private const float NearPrototypeDistanceMetres = 750f;
        private const float NearShadowDistanceMetres = 400f;
        private readonly List<TreeBatch> batches = new();
        private readonly Mesh[] midCrowns = new Mesh[VariantCount];
        private readonly Mesh[] nearCrowns = new Mesh[VariantCount];
        private readonly Material[] crownMaterials = new Material[VariantCount];
        private Mesh trunk;
        private Material trunkMaterial;
        private Matrix4x4 cachedLocalToWorld;
        private bool worldMatricesReady;

        public void Configure(FwTreeInstance[] trees, Shader shader)
        {
            trunk = BuildTaperedCylinder(7, 0.075f, 0.045f, 0f, 0.56f);
            trunkMaterial = BuildMaterial(shader, "Tree trunk — matte", new Color(0.22f, 0.16f, 0.10f));
            Color[] palette =
            {
                new(0.10f, 0.23f, 0.12f), new(0.14f, 0.28f, 0.14f), new(0.18f, 0.30f, 0.15f),
                new(0.09f, 0.21f, 0.12f), new(0.12f, 0.25f, 0.13f), new(0.16f, 0.27f, 0.14f),
            };
            for (int variant = 0; variant < VariantCount; variant++)
            {
                midCrowns[variant] = BuildCrown(variant, false);
                nearCrowns[variant] = BuildCrown(variant, true);
                crownMaterials[variant] = BuildMaterial(shader, $"Tree foliage variant {variant}", palette[variant]);
            }

            var groups = new List<Matrix4x4>[VariantCount];
            for (int variant = 0; variant < VariantCount; variant++) groups[variant] = new List<Matrix4x4>();
            foreach (FwTreeInstance tree in trees)
            {
                int variant = tree.Variant % VariantCount;
                groups[variant].Add(Matrix4x4.TRS(
                    new Vector3(tree.Position.X, tree.Position.Y, tree.Position.Z),
                    Quaternion.Euler(0f, tree.RotationDegrees, 0f),
                    new Vector3(tree.CrownDiameter, tree.Height, tree.CrownDiameter)));
            }

            for (int variant = 0; variant < VariantCount; variant++)
            for (int start = 0; start < groups[variant].Count; start += MaximumBatch)
            {
                int count = Math.Min(MaximumBatch, groups[variant].Count - start);
                var local = new Matrix4x4[count];
                var world = new Matrix4x4[count];
                Vector3 centre = Vector3.zero;
                for (int offset = 0; offset < count; offset++)
                {
                    local[offset] = groups[variant][start + offset];
                    Vector4 position = local[offset].GetColumn(3);
                    centre += new Vector3(position.x, position.y, position.z);
                }
                batches.Add(new TreeBatch(variant, local, world, centre / count));
            }
        }

        private void LateUpdate()
        {
            Matrix4x4 localToWorld = transform.localToWorldMatrix;
            if (!worldMatricesReady || !MatrixApproximatelyEqual(localToWorld, cachedLocalToWorld))
            {
                foreach (TreeBatch batch in batches)
                    for (int index = 0; index < batch.Local.Length; index++) batch.World[index] = localToWorld * batch.Local[index];
                cachedLocalToWorld = localToWorld;
                worldMatricesReady = true;
            }

            Camera camera = Camera.main;
            float scale = Mathf.Max(0.0001f, Mathf.Abs(transform.lossyScale.x));
            foreach (TreeBatch batch in batches)
            {
                float distanceMetres = camera == null
                    ? 0f
                    : Vector3.Distance(camera.transform.position, transform.TransformPoint(batch.LocalCentre)) / scale;
                bool near = distanceMetres <= NearPrototypeDistanceMetres;
                ShadowCastingMode shadows = distanceMetres <= NearShadowDistanceMetres ? ShadowCastingMode.On : ShadowCastingMode.Off;
                if (near)
                    Graphics.DrawMeshInstanced(trunk, 0, trunkMaterial, batch.World, batch.World.Length, null, shadows, true, gameObject.layer);
                Graphics.DrawMeshInstanced(
                    near ? nearCrowns[batch.Variant] : midCrowns[batch.Variant],
                    0,
                    crownMaterials[batch.Variant],
                    batch.World,
                    batch.World.Length,
                    null,
                    shadows,
                    true,
                    gameObject.layer);
            }
        }

        private void OnDestroy()
        {
            DestroyRuntime(trunk);
            DestroyRuntime(trunkMaterial);
            for (int variant = 0; variant < VariantCount; variant++)
            {
                DestroyRuntime(midCrowns[variant]);
                DestroyRuntime(nearCrowns[variant]);
                DestroyRuntime(crownMaterials[variant]);
            }
        }

        private static Material BuildMaterial(Shader shader, string name, Color colour)
        {
            var material = new Material(shader) { name = name, enableInstancing = true, renderQueue = 2010 };
            if (material.HasProperty("_Color")) material.SetColor("_Color", colour);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.03f);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.03f);
            return material;
        }

        private static Mesh BuildCrown(int variant, bool detailed)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            if (variant < 3)
            {
                if (!detailed)
                {
                    AppendEllipsoid(vertices, triangles, new Vector3(0f, 0.72f, 0f), new Vector3(0.46f, 0.31f, 0.42f), 10, 5, variant);
                }
                else
                {
                    AppendEllipsoid(vertices, triangles, new Vector3(0f, 0.74f, 0f), new Vector3(0.30f, 0.28f, 0.28f), 10, 5, variant);
                    AppendEllipsoid(vertices, triangles, new Vector3(-0.20f, 0.67f, 0.04f), new Vector3(0.25f, 0.23f, 0.24f), 9, 5, variant + 2);
                    AppendEllipsoid(vertices, triangles, new Vector3(0.20f, 0.69f, -0.03f), new Vector3(0.24f, 0.24f, 0.23f), 9, 5, variant + 4);
                    AppendEllipsoid(vertices, triangles, new Vector3(0.03f, 0.88f, 0.12f), new Vector3(0.23f, 0.19f, 0.22f), 9, 4, variant + 6);
                }
            }
            else
            {
                int sides = detailed ? 12 : 10;
                AppendCone(vertices, triangles, 0.28f, 0.72f, 0.48f, sides, variant);
                AppendCone(vertices, triangles, 0.47f, 0.86f, 0.37f, sides, variant + 2);
                AppendCone(vertices, triangles, 0.64f, 1.00f, 0.25f, sides, variant + 4);
                if (detailed) AppendCone(vertices, triangles, 0.18f, 0.55f, 0.40f, sides, variant + 6);
            }
            var mesh = new Mesh
            {
                name = detailed ? $"FireViewer near tree crown {variant}" : $"FireViewer mid tree crown {variant}",
                vertices = vertices.ToArray(),
                triangles = triangles.ToArray(),
            };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(true);
            return mesh;
        }

        private static void AppendEllipsoid(
            List<Vector3> vertices,
            List<int> triangles,
            Vector3 centre,
            Vector3 radius,
            int sides,
            int latitudeSegments,
            int seed)
        {
            int top = vertices.Count;
            vertices.Add(centre + Vector3.up * radius.y);
            int firstRing = vertices.Count;
            for (int latitude = 1; latitude < latitudeSegments; latitude++)
            {
                float polar = Mathf.PI * latitude / latitudeSegments;
                float ring = Mathf.Sin(polar);
                for (int side = 0; side < sides; side++)
                {
                    float angle = side * Mathf.PI * 2f / sides;
                    float irregular = 1f + 0.055f * Mathf.Sin(angle * (3 + seed % 3) + seed * 0.73f);
                    vertices.Add(centre + new Vector3(
                        Mathf.Cos(angle) * radius.x * ring * irregular,
                        Mathf.Cos(polar) * radius.y,
                        Mathf.Sin(angle) * radius.z * ring * irregular));
                }
            }
            int bottom = vertices.Count;
            vertices.Add(centre - Vector3.up * radius.y);
            for (int side = 0; side < sides; side++)
            {
                int next = (side + 1) % sides;
                triangles.Add(top); triangles.Add(firstRing + side); triangles.Add(firstRing + next);
            }
            for (int latitude = 0; latitude < latitudeSegments - 2; latitude++)
            {
                int first = firstRing + latitude * sides;
                int second = first + sides;
                for (int side = 0; side < sides; side++)
                {
                    int next = (side + 1) % sides;
                    triangles.Add(first + side); triangles.Add(second + side); triangles.Add(second + next);
                    triangles.Add(first + side); triangles.Add(second + next); triangles.Add(first + next);
                }
            }
            int lastRing = firstRing + (latitudeSegments - 2) * sides;
            for (int side = 0; side < sides; side++)
            {
                int next = (side + 1) % sides;
                triangles.Add(lastRing + side); triangles.Add(bottom); triangles.Add(lastRing + next);
            }
        }

        private static void AppendCone(
            List<Vector3> vertices,
            List<int> triangles,
            float baseY,
            float tipY,
            float radius,
            int sides,
            int seed)
        {
            int baseStart = vertices.Count;
            for (int side = 0; side < sides; side++)
            {
                float angle = side * Mathf.PI * 2f / sides;
                float irregular = 1f + 0.045f * Mathf.Sin(angle * (3 + seed % 4) + seed * 0.51f);
                vertices.Add(new Vector3(Mathf.Cos(angle) * radius * irregular, baseY, Mathf.Sin(angle) * radius * irregular));
            }
            int tip = vertices.Count;
            vertices.Add(new Vector3(0f, tipY, 0f));
            int baseCentre = vertices.Count;
            vertices.Add(new Vector3(0f, baseY, 0f));
            for (int side = 0; side < sides; side++)
            {
                int next = (side + 1) % sides;
                triangles.Add(baseStart + side); triangles.Add(tip); triangles.Add(baseStart + next);
                triangles.Add(baseStart + side); triangles.Add(baseStart + next); triangles.Add(baseCentre);
            }
        }

        private static Mesh BuildTaperedCylinder(int sides, float bottomRadius, float topRadius, float bottomY, float topY)
        {
            var vertices = new Vector3[sides * 2 + 2];
            var triangles = new int[sides * 12];
            int bottomCentre = sides * 2;
            int topCentre = bottomCentre + 1;
            vertices[bottomCentre] = new Vector3(0f, bottomY, 0f);
            vertices[topCentre] = new Vector3(0f, topY, 0f);
            for (int index = 0; index < sides; index++)
            {
                float angle = index * Mathf.PI * 2f / sides;
                vertices[index] = new Vector3(Mathf.Cos(angle) * bottomRadius, bottomY, Mathf.Sin(angle) * bottomRadius);
                vertices[index + sides] = new Vector3(Mathf.Cos(angle) * topRadius, topY, Mathf.Sin(angle) * topRadius);
                int next = (index + 1) % sides;
                int offset = index * 12;
                triangles[offset] = index; triangles[offset + 1] = index + sides; triangles[offset + 2] = next + sides;
                triangles[offset + 3] = index; triangles[offset + 4] = next + sides; triangles[offset + 5] = next;
                triangles[offset + 6] = bottomCentre; triangles[offset + 7] = next; triangles[offset + 8] = index;
                triangles[offset + 9] = topCentre; triangles[offset + 10] = index + sides; triangles[offset + 11] = next + sides;
            }
            var mesh = new Mesh { name = "FireViewer instanced tapered trunk", vertices = vertices, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(true);
            return mesh;
        }

        private static bool MatrixApproximatelyEqual(Matrix4x4 first, Matrix4x4 second)
        {
            for (int row = 0; row < 4; row++)
            for (int column = 0; column < 4; column++)
                if (Mathf.Abs(first[row, column] - second[row, column]) > 0.000001f) return false;
            return true;
        }

        private static void DestroyRuntime(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }

        private sealed class TreeBatch
        {
            public TreeBatch(int variant, Matrix4x4[] local, Matrix4x4[] world, Vector3 localCentre)
            {
                Variant = variant;
                Local = local;
                World = world;
                LocalCentre = localCentre;
            }

            public int Variant { get; }
            public Matrix4x4[] Local { get; }
            public Matrix4x4[] World { get; }
            public Vector3 LocalCentre { get; }
        }
    }
}

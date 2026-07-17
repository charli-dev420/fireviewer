using System;
using System.IO;
using System.Net.Http;
using FireViewer.SpatialTiles;
using UnityEditor;
using UnityEngine;

public static class FireViewerBridgeSmoke
{
    public static void Run()
    {
        GameObject root = null;
        Texture2D texture = null;
        FwTileUnityBuilder builder = null;
        try
        {
            string catalogUrl = Argument("-catalogUrl");
            using var http = new HttpClient();
            string catalogJson = http.GetStringAsync(catalogUrl).GetAwaiter().GetResult();
            var parser = new UnityJsonParser();
            FwRemoteCatalog catalog = parser.Parse<FwRemoteCatalog>(catalogJson);
            catalog.Validate();
            if (catalog.tiles.Length != 1) throw new InvalidDataException("Smoke catalog must expose one detail tile.");
            FwCatalogTile tile = catalog.tiles[0];
            byte[] payload = http.GetByteArrayAsync(new Uri(new Uri(catalogUrl), tile.payload.url)).GetAwaiter().GetResult();
            FwTileContainerDecoder.VerifySha256(payload, tile.payload.sha256, "Unity HTTP payload");
            FwDecodedContainer container = FwTileContainerDecoder.Decode(payload, parser);
            FwTileGeometry geometry = FwTileGeometryDecoder.Decode(container, catalog.origin_l93_m);
            byte[] imagery = http.GetByteArrayAsync(new Uri(new Uri(catalogUrl), tile.imagery.url)).GetAwaiter().GetResult();
            FwTileContainerDecoder.VerifySha256(imagery, tile.imagery.sha256, "Unity HTTP imagery");
            texture = new Texture2D(2, 2, TextureFormat.RGBA32, false, false);
            if (!texture.LoadImage(imagery, false)) throw new InvalidDataException("Unity failed to decode smoke imagery.");
            builder = new FwTileUnityBuilder();
            root = builder.Build(geometry, texture, null, 1f);

            MeshFilter[] filters = root.GetComponentsInChildren<MeshFilter>(true);
            MeshFilter terrain = Array.Find(filters, item => item.gameObject.name == "Terrain");
            if (terrain == null || terrain.sharedMesh.vertexCount != 9 || terrain.sharedMesh.triangles.Length != 24)
                throw new InvalidDataException("Unity terrain GameObject does not contain the expected 9-vertex/8-triangle mesh.");
            Transform trees = root.transform.Find("Trees — detected crowns, operational LOD");
            if (geometry.Trees.Length != 2 || builder.LastSourceTreeCount != 2 ||
                builder.LastVisibleTreeCount != 1 || builder.LastMaskedTreeCount != 1 || trees == null)
                throw new InvalidDataException(
                    $"Unity vegetation masking is invalid: source={builder.LastSourceTreeCount}, " +
                    $"visible={builder.LastVisibleTreeCount}, masked={builder.LastMaskedTreeCount}.");
            MeshRenderer buildingRenderer = Array.Find(
                root.GetComponentsInChildren<MeshRenderer>(true),
                item => item.transform.parent != null && item.transform.parent.gameObject.name == "Buildings");
            if (buildingRenderer == null || buildingRenderer.sharedMaterial.shader.name != "FireViewer/Operational Building")
                throw new InvalidDataException("Unity did not apply the operational building shader.");
            if (geometry.Buildings.Length != 1 || geometry.Roads.Length != 1 || geometry.Water.Length != 1 || filters.Length < 4)
                throw new InvalidDataException("Unity did not materialize all vector mesh sections.");

            Debug.Log(
                $"FIREVIEWER_UNITY_HTTP_BRIDGE_OK tile={geometry.TileId} " +
                $"terrainVertices={terrain.sharedMesh.vertexCount} terrainTriangles={terrain.sharedMesh.triangles.Length / 3} " +
                $"treesSource={geometry.Trees.Length} treesVisible={builder.LastVisibleTreeCount} " +
                $"treesMasked={builder.LastMaskedTreeCount} buildingShader={buildingRenderer.sharedMaterial.shader.name} " +
                $"meshFilters={filters.Length}");
            Cleanup(root, texture, builder);
            EditorApplication.Exit(0);
        }
        catch (Exception exception)
        {
            Debug.LogException(exception);
            Cleanup(root, texture, builder);
            EditorApplication.Exit(1);
        }
    }

    private static string Argument(string name)
    {
        string[] arguments = Environment.GetCommandLineArgs();
        for (int index = 0; index + 1 < arguments.Length; index++)
            if (string.Equals(arguments[index], name, StringComparison.Ordinal)) return arguments[index + 1];
        throw new ArgumentException($"Missing required argument {name}.");
    }

    private static void Cleanup(GameObject root, Texture2D texture, FwTileUnityBuilder builder)
    {
        if (root != null) UnityEngine.Object.DestroyImmediate(root);
        builder?.Dispose();
        if (texture != null) UnityEngine.Object.DestroyImmediate(texture);
    }

    private sealed class UnityJsonParser : IFwJsonParser
    {
        public T Parse<T>(string json) => JsonUtility.FromJson<T>(json)
            ?? throw new FormatException($"JSON produced no {typeof(T).Name} object.");
    }
}

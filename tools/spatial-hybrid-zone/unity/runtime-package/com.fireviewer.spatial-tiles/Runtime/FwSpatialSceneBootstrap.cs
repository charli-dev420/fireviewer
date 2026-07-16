using UnityEngine;

namespace FireViewer.SpatialTiles
{
    [DisallowMultipleComponent]
    [AddComponentMenu("FireViewer/Spatial Scene Bootstrap")]
    public sealed class FwSpatialSceneBootstrap : MonoBehaviour
    {
        [SerializeField] private string catalogUrl = string.Empty;
        [SerializeField] private Camera viewerCamera;
        [SerializeField] private bool useCameraAsFocus;
        [SerializeField] private string initialFocusZone = "montmaur";
        [SerializeField, Min(0.0001f)] private float unityUnitsPerMetre = 1f;
        [SerializeField, Range(1, FwSpatialLodPlanner.AbsoluteMaximumResidentTiles)] private int residentBudget = 16;
        [SerializeField] private FwSpatialTileStreamingController controller;
        [SerializeField] private FwSpatialCameraController cameraController;

        public FwSpatialTileStreamingController Controller => controller;

        public void Configure(string remoteCatalogUrl, Camera camera = null, string focusZone = "montmaur")
        {
            catalogUrl = remoteCatalogUrl ?? string.Empty;
            viewerCamera = camera;
            initialFocusZone = focusZone ?? string.Empty;
            BuildOrConfigure();
        }

        public static FwSpatialSceneBootstrap Create(string remoteCatalogUrl, Camera camera = null, string focusZone = "montmaur")
        {
            var root = new GameObject("FireViewer Spatial Runtime");
            FwSpatialSceneBootstrap bootstrap = root.AddComponent<FwSpatialSceneBootstrap>();
            bootstrap.Configure(remoteCatalogUrl, camera, focusZone);
            return bootstrap;
        }

        private void Awake() => BuildOrConfigure();

        private void BuildOrConfigure()
        {
            Transform frame = Child("Local Frame ENU");
            Transform content = Child("Streamed Content");
            Transform target = useCameraAsFocus && viewerCamera != null ? viewerCamera.transform : Child("Focus Target");
            if (controller == null) controller = gameObject.GetComponent<FwSpatialTileStreamingController>() ?? gameObject.AddComponent<FwSpatialTileStreamingController>();
            controller.Configure(catalogUrl, target, frame, content, unityUnitsPerMetre, residentBudget);
            controller.SetViewerCamera(viewerCamera);
            if (viewerCamera != null)
            {
                cameraController = viewerCamera.GetComponent<FwSpatialCameraController>() ?? viewerCamera.gameObject.AddComponent<FwSpatialCameraController>();
                cameraController.Configure(viewerCamera, target, controller, unityUnitsPerMetre);
            }
            if (!string.IsNullOrWhiteSpace(initialFocusZone)) controller.FocusZone(initialFocusZone);
        }

        private Transform Child(string name)
        {
            Transform existing = transform.Find(name);
            if (existing != null) return existing;
            var child = new GameObject(name);
            child.transform.SetParent(transform, false);
            return child.transform;
        }
    }
}

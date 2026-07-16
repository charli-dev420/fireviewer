using UnityEngine;

namespace FireViewer.SpatialTiles
{
    /// <summary>
    /// Runtime navigation for the validation scene.  The camera orbits the
    /// Lambert-93 focus while the streaming controller derives its LOD from
    /// the real camera-to-focus distance.
    /// </summary>
    [DisallowMultipleComponent]
    [AddComponentMenu("FireViewer/Spatial Camera Controller")]
    public sealed class FwSpatialCameraController : MonoBehaviour
    {
        private const float NearDistanceMetres = 350f;
        private const float MidDistanceMetres = 1400f;
        private const float FarDistanceMetres = 15000f;

        [SerializeField] private Camera viewerCamera;
        [SerializeField] private Transform focus;
        [SerializeField] private FwSpatialTileStreamingController streaming;
        [SerializeField, Min(0.0001f)] private float unityUnitsPerMetre = 1f;
        [SerializeField, Range(-85f, 85f)] private float pitchDegrees = 38f;
        [SerializeField] private float yawDegrees = -18f;
        [SerializeField, Min(25f)] private float distanceMetres = FarDistanceMetres;
        [SerializeField, Min(0.01f)] private float orbitSensitivity = 0.18f;
        [SerializeField, Min(0.01f)] private float zoomSensitivity = 0.18f;
        [SerializeField] private bool showValidationHud = true;

        private bool configured;

        public float DistanceMetres => distanceMetres;

        public void Configure(
            Camera camera,
            Transform focusTransform,
            FwSpatialTileStreamingController streamingController,
            float unitsPerMetre)
        {
            viewerCamera = camera;
            focus = focusTransform;
            streaming = streamingController;
            unityUnitsPerMetre = Mathf.Max(0.0001f, unitsPerMetre);
            configured = viewerCamera != null && focus != null;
            if (configured)
            {
                viewerCamera.transform.SetParent(focus, false);
                ApplyPose();
            }
        }

        public void SetNearView() => SetViewDistance(NearDistanceMetres, "near");
        public void SetMidView() => SetViewDistance(MidDistanceMetres, "mid");
        public void SetFarView() => SetViewDistance(FarDistanceMetres, "far");

        private void Awake()
        {
            if (viewerCamera == null) viewerCamera = GetComponent<Camera>();
        }

        private void Update()
        {
            if (!configured || viewerCamera == null || focus == null) return;

            if (Input.GetMouseButton(1))
            {
                yawDegrees += Input.GetAxis("Mouse X") * orbitSensitivity * 100f;
                pitchDegrees = Mathf.Clamp(
                    pitchDegrees - Input.GetAxis("Mouse Y") * orbitSensitivity * 100f,
                    -10f,
                    85f);
            }

            float wheel = Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Abs(wheel) > 0.0001f)
                distanceMetres = Mathf.Clamp(
                    distanceMetres * Mathf.Exp(-wheel * zoomSensitivity * 10f),
                    25f,
                    25_000f);

            if (Input.GetKeyDown(KeyCode.Alpha1)) SetFarView();
            if (Input.GetKeyDown(KeyCode.Alpha2)) SetMidView();
            if (Input.GetKeyDown(KeyCode.Alpha3)) SetNearView();
            if (Input.GetKeyDown(KeyCode.M)) streaming?.FocusMontmaur();
            if (Input.GetKeyDown(KeyCode.B)) streaming?.FocusBarsac();
            if (Input.GetKeyDown(KeyCode.A)) streaming?.FocusAusson();

            PanFocus();
            ApplyPose();
        }

        private void PanFocus()
        {
            float horizontal = Input.GetAxisRaw("Horizontal");
            float vertical = Input.GetAxisRaw("Vertical");
            float altitude = 0f;
            if (Input.GetKey(KeyCode.E) || Input.GetKey(KeyCode.PageUp)) altitude += 1f;
            if (Input.GetKey(KeyCode.Q) || Input.GetKey(KeyCode.PageDown)) altitude -= 1f;
            if (Mathf.Abs(horizontal) < 0.001f && Mathf.Abs(vertical) < 0.001f && Mathf.Abs(altitude) < 0.001f)
                return;

            Vector3 forward = Vector3.ProjectOnPlane(viewerCamera.transform.forward, Vector3.up).normalized;
            if (forward.sqrMagnitude < 0.01f) forward = Vector3.forward;
            Vector3 right = Vector3.Cross(Vector3.up, forward).normalized;
            float speedMetresPerSecond = Mathf.Max(20f, distanceMetres * 0.45f);
            Vector3 movementMetres = (right * horizontal + forward * vertical + Vector3.up * altitude) * speedMetresPerSecond * Time.unscaledDeltaTime;
            focus.position += movementMetres * unityUnitsPerMetre;
        }

        private void SetViewDistance(float value, string band)
        {
            distanceMetres = value;
            ApplyPose();
            Debug.Log($"FIREVIEWER_SPATIAL_VIEW_CHANGED band={band} distanceM={distanceMetres:0}", this);
        }

        private void ApplyPose()
        {
            if (viewerCamera == null || focus == null) return;
            Quaternion rotation = Quaternion.Euler(pitchDegrees, yawDegrees, 0f);
            viewerCamera.transform.localRotation = rotation;
            viewerCamera.transform.localPosition = rotation * Vector3.back * (distanceMetres * unityUnitsPerMetre);
        }

        private void OnGUI()
        {
            if (!showValidationHud || streaming == null) return;
            FwSpatialStreamingTelemetry state = streaming.Telemetry;
            GUILayout.BeginArea(new Rect(16f, 16f, 330f, 238f), GUI.skin.box);
            GUILayout.Label("FireViewer — contrôle LOD spatial");
            GUILayout.Label($"État : {state.state}    LOD : {state.lod_band}");
            GUILayout.Label($"Zone : {state.focus_zone}    Distance : {state.view_distance_m:0} m");
            GUILayout.Label($"Détails : {state.visible_detail_tile_count}/{state.desired_tile_count} tuiles visibles");

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Montmaur")) streaming.FocusMontmaur();
            if (GUILayout.Button("Barsac")) streaming.FocusBarsac();
            if (GUILayout.Button("Ausson")) streaming.FocusAusson();
            GUILayout.EndHorizontal();

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("1  Vue globale")) SetFarView();
            if (GUILayout.Button("2  Moyen")) SetMidView();
            if (GUILayout.Button("3  Proche")) SetNearView();
            GUILayout.EndHorizontal();

            GUILayout.Label("Souris droite : orbite   Molette : zoom");
            GUILayout.Label("ZQSD/flèches : déplacer   Q/E : altitude");
            if (!string.IsNullOrEmpty(state.last_error)) GUILayout.Label($"Erreur : {state.last_error}");
            GUILayout.EndArea();
        }
    }
}

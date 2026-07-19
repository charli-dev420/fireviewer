// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { AdminApiClient } from './adminApi';
import { uploadIncidentMapCapture } from './mapCaptureUpload';

describe('uploadIncidentMapCapture', () => {
  it('uses the private one-file grant and finalizes the exact captured object', async () => {
    const createGrant = vi.fn(async () => ({
      upload_id: 'a'.repeat(32),
      pathname_prefix: `gallery-captures/${'a'.repeat(32)}`,
      upload_grant: 'signed-gallery-grant',
      expires_at: '2026-07-19T18:00:00Z',
      maximum_file_size_bytes: 8 * 1_024 * 1_024,
      allowed_content_types: ['image/jpeg'],
    }));
    const finalize = vi.fn(async () => ({
      capture_id: 'mapcap-1',
      zone_revision_id: 'azr-1',
      local_date: '2026-07-09',
      captured_at: '2026-07-19T17:00:00Z',
      image_url: '/api/v1/admin/incidents/FR-26-00001/map-gallery/mapcap-1',
      width_px: 960,
      height_px: 540,
    }));
    const api = {
      createIncidentMapCaptureUploadGrant: createGrant,
      getBlobUploadTokenUrl: () => 'https://api.example.test/api/v1/admin/blob-upload-token',
      finalizeIncidentMapCaptureFromBlob: finalize,
    } as unknown as AdminApiClient;
    const uploader = vi.fn(async (pathname: string) => ({
      pathname,
      contentType: 'image/jpeg',
    }));
    const image = new Blob(['real-canvas-bytes'], { type: 'image/jpeg' });

    await expect(uploadIncidentMapCapture(api, {
      fireId: 'FR-26-00001',
      zoneRevisionId: 'azr-1',
      image,
      uploader,
    })).resolves.toMatchObject({ capture_id: 'mapcap-1' });

    expect(createGrant).toHaveBeenCalledWith('FR-26-00001', {
      zone_revision_id: 'azr-1',
      size_bytes: image.size,
      media_type: 'image/jpeg',
    });
    expect(uploader).toHaveBeenCalledWith(
      `gallery-captures/${'a'.repeat(32)}/capture.jpg`,
      expect.any(File),
      expect.objectContaining({
        access: 'private',
        clientPayload: 'azr-1',
        contentType: 'image/jpeg',
        headers: { 'X-Blob-Upload-Grant': 'signed-gallery-grant' },
        multipart: true,
      }),
    );
    expect(finalize).toHaveBeenCalledWith('FR-26-00001', {
      upload_id: 'a'.repeat(32),
      zone_revision_id: 'azr-1',
      object: {
        path: 'capture.jpg',
        pathname: `gallery-captures/${'a'.repeat(32)}/capture.jpg`,
        size_bytes: image.size,
        content_type: 'image/jpeg',
      },
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AdminApiClient } from './adminApi';
import { uploadIncidentSourcePackage } from './sourcePackageUpload';

describe('uploadIncidentSourcePackage', () => {
  it('utilise le contrat utilisateur normal et calcule les données techniques automatiquement', async () => {
    const files = [
      new File(['image'], 'photo feu.jpg', { type: 'image/jpeg' }),
      new File(['point quotidien'], 'point-mairie.txt', { type: 'text/plain' }),
    ];
    const openIncidentSourcePackage = vi.fn().mockResolvedValue({
      package_id: 'source-package-0001',
      upload_id: 'upload-0001',
      pathname_prefix: 'firewarning/source-packages/upload-0001',
      upload_grant: 'g'.repeat(128),
      expires_at: '2030-01-01T00:00:00Z',
      maximum_file_size_bytes: 10_000,
      allowed_content_types: ['image/jpeg', 'text/plain'],
    });
    const finalizeIncidentSourcePackage = vi.fn().mockResolvedValue({
      package_id: 'source-package-0001',
      state: 'CONVERTED',
      known_start_date: '2026-07-09',
      known_end_date: '2026-07-09',
      publication_authorized: false,
      batch_ids: ['batch-1'],
      item_count: 2,
    });
    const api = {
      openIncidentSourcePackage,
      finalizeIncidentSourcePackage,
      getBlobUploadTokenUrl: () => 'https://fireviewer.example/blob-upload-token',
    } as unknown as AdminApiClient;
    const uploader = vi.fn().mockResolvedValue({ pathname: 'stored' });

    const result = await uploadIncidentSourcePackage(api, {
      fireId: 'FR-26-00001',
      files,
      localDate: '2026-07-09',
      locationHint: 'Die, massif de Justin',
      idempotencyKey: 'source-upload-intent-1',
      uploader,
    });

    expect(openIncidentSourcePackage).toHaveBeenCalledWith(
      'FR-26-00001',
      expect.objectContaining({
        file_count: 2,
        total_size_bytes: files[0]!.size + files[1]!.size,
        known_start_date: '2026-07-09',
        authorize_private_analysis: true,
      }),
      { idempotencyKey: 'source-upload-intent-1' },
    );
    expect(uploader).toHaveBeenCalledTimes(2);
    expect(uploader.mock.calls[0]![0]).toBe(
      'firewarning/source-packages/upload-0001/0001-photo_feu.jpg',
    );
    expect(uploader.mock.calls[0]![2]).toEqual(expect.objectContaining({
      access: 'private',
      clientPayload: 'source-package-0001',
      headers: { 'X-Blob-Upload-Grant': 'g'.repeat(128) },
    }));
    expect(finalizeIncidentSourcePackage).toHaveBeenCalledWith(
      'source-package-0001',
      { idempotencyKey: 'source-upload-intent-1:finalize' },
    );
    expect(result.publication_authorized).toBe(false);
  });
});

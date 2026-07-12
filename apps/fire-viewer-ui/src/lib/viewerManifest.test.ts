import { describe, expect, it } from 'vitest';

import availableFixture from '../../../../contracts/viewer-manifest/v2/examples/available.json';
import notAvailableFixture from '../../../../contracts/viewer-manifest/v2/examples/not_available.json';
import withheldFixture from '../../../../contracts/viewer-manifest/v2/examples/withheld.json';
import { isValidFireId } from './api';
import {
  ViewerManifestParseError,
  parseViewerManifest,
  toViewerManifestSummary,
} from './viewerManifest';

const fixtures = [
  ['available', availableFixture],
  ['not_available', notAvailableFixture],
  ['withheld', withheldFixture],
] as const;

function clonedFixture(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

describe('parseViewerManifest', () => {
  it.each(fixtures)('accepte le fixture partagé %s', (_name, fixture) => {
    expect(parseViewerManifest(fixture)).toEqual(fixture);
  });

  it('conserve le snake_case du DTO réseau et rejette le camelCase', () => {
    const invalid = clonedFixture(availableFixture);
    invalid.fireId = invalid.fire_id;
    delete invalid.fire_id;

    expect(() => parseViewerManifest(invalid)).toThrow(ViewerManifestParseError);
    expect(() => parseViewerManifest(invalid)).toThrow('fireId');
  });

  it('refuse une version de schéma inconnue', () => {
    const invalid = clonedFixture(availableFixture);
    invalid.schema_version = '2.1';

    expect(() => parseViewerManifest(invalid)).toThrow('schema_version');
  });

  it('valide la regex réelle de fire_id', () => {
    const threeCharacterPrefix = clonedFixture(availableFixture);
    threeCharacterPrefix.fire_id = 'FR-ABC-00042';
    expect(parseViewerManifest(threeCharacterPrefix).fire_id).toBe('FR-ABC-00042');
    expect(isValidFireId('FR-ABC-00042')).toBe(true);

    const invalid = clonedFixture(availableFixture);
    invalid.fire_id = 'FR-8-00042';
    expect(() => parseViewerManifest(invalid)).toThrow('fire_id');
    expect(isValidFireId('FR-8-00042')).toBe(false);
  });

  it('accepte explicitement les statuts backend UNDER_REVIEW et REJECTED', () => {
    expect(parseViewerManifest(availableFixture).status.code).toBe('UNDER_REVIEW');
    expect(parseViewerManifest(notAvailableFixture).status.code).toBe('REJECTED');
  });

  it('applique les invariants des trois états de modèle', () => {
    const available = parseViewerManifest(availableFixture);
    expect(available.model_state).toBe('available');
    expect(available.location).not.toBeNull();
    expect(available.asset).not.toBeNull();
    expect(available.frame).not.toBeNull();

    const notAvailable = parseViewerManifest(notAvailableFixture);
    expect(notAvailable.model_state).toBe('not_available');
    expect(notAvailable.location).not.toBeNull();
    expect(notAvailable.asset).toBeNull();
    expect(notAvailable.frame).toBeNull();

    const withheld = parseViewerManifest(withheldFixture);
    expect(withheld.model_state).toBe('withheld');
    expect(withheld.location).toBeNull();
    expect(withheld.asset).toBeNull();
    expect(withheld.frame).toBeNull();
  });

  it('rejette un état available dépourvu d’asset publié', () => {
    const invalid = clonedFixture(availableFixture);
    invalid.asset = null;

    expect(() => parseViewerManifest(invalid)).toThrow('"available"');
  });

  it('produit un résumé sans données issues du fixture de démonstration', () => {
    const summary = toViewerManifestSummary(parseViewerManifest(availableFixture));

    expect(summary.fireId).toBe('FR-83-00042');
    expect(summary.sources).toEqual([]);
    expect(summary.history).toEqual([]);
    expect(summary.journal).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import visibilityMatrix from '../../../../contracts/demo/v1/visibility-matrix.json';
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

const fixtureForModelState = {
  available: availableFixture,
  not_available: notAvailableFixture,
  withheld: withheldFixture,
} as const;

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

  it('associe les exemples partagés aux cycles de vie canoniques', () => {
    expect(parseViewerManifest(availableFixture).status.code).toBe('MONITORING');
    expect(parseViewerManifest(notAvailableFixture).status.code).toBe('MONITORING');
    expect(parseViewerManifest(withheldFixture).status.code).toBe('UNDER_REVIEW');
  });

  it('accepte le profil spatial Unity canonique du manifeste disponible', () => {
    expect(parseViewerManifest(availableFixture).frame).toMatchObject({
      local_frame: 'ENU',
      meters_per_unit: 0.01,
      vertical_datum: 'EPSG:4979',
    });
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

  it.each([
    ['CANDIDATE', 'withheld', withheldFixture],
    ['UNDER_REVIEW', 'withheld', withheldFixture],
    ['REJECTED', 'withheld', withheldFixture],
    ['SUSPENDED', 'withheld', withheldFixture],
    ['ACTIVE_CONFIRMED', 'available', availableFixture],
    ['ACTIVE_CONFIRMED', 'not_available', notAvailableFixture],
    ['MONITORING', 'available', availableFixture],
    ['MONITORING', 'not_available', notAvailableFixture],
    ['EXTINGUISHED', 'available', availableFixture],
    ['EXTINGUISHED', 'not_available', notAvailableFixture],
    ['CLOSED', 'not_available', notAvailableFixture],
  ] as const)(
    'accepte la paire de cycle de vie canonique %s / %s',
    (statusCode, _modelState, fixture) => {
      const manifest = clonedFixture(fixture);
      (manifest.status as Record<string, unknown>).code = statusCode;

      expect(parseViewerManifest(manifest).status.code).toBe(statusCode);
    },
  );

  it('applique la matrice versionnée de démonstration aux manifests réseau', () => {
    for (const scenario of visibilityMatrix.scenarios) {
      const fixture = fixtureForModelState[
        scenario.model_state as keyof typeof fixtureForModelState
      ];
      const manifest = clonedFixture(fixture);
      (manifest.status as Record<string, unknown>).code = scenario.status;

      expect(parseViewerManifest(manifest).model_state).toBe(scenario.model_state);
    }

    expect(visibilityMatrix.tombstone.http_status).toBe(410);
  });

  it.each([
    ['UNDER_REVIEW', 'available', availableFixture],
    ['REJECTED', 'not_available', notAvailableFixture],
    ['CLOSED', 'available', availableFixture],
    ['MONITORING', 'withheld', withheldFixture],
  ] as const)(
    'rejette la paire de cycle de vie invalide %s / %s',
    (statusCode, modelState, fixture) => {
      const manifest = clonedFixture(fixture);
      (manifest.status as Record<string, unknown>).code = statusCode;
      manifest.model_state = modelState;

      expect(() => parseViewerManifest(manifest)).toThrow(
        `"${statusCode}" ne peut pas être associé à model_state "${modelState}"`,
      );
    },
  );

  it.each([1, 100])('rejette une échelle Unity non canonique (%s)', (metersPerUnit) => {
    const invalid = clonedFixture(availableFixture);
    (invalid.frame as Record<string, unknown>).meters_per_unit = metersPerUnit;

    expect(() => parseViewerManifest(invalid)).toThrow('frame.meters_per_unit');
  });

  it('rejette un repère local autre que ENU', () => {
    const invalid = clonedFixture(availableFixture);
    (invalid.frame as Record<string, unknown>).local_frame = 'EUN';

    expect(() => parseViewerManifest(invalid)).toThrow('frame.local_frame');
  });

  it('rejette un datum vertical libre', () => {
    const invalid = clonedFixture(availableFixture);
    (invalid.frame as Record<string, unknown>).vertical_datum = 'NGF-IGN69';

    expect(() => parseViewerManifest(invalid)).toThrow('frame.vertical_datum');
  });

  it.each([
    ['longitude hors bornes', [180.000001, 0, 0]],
    ['latitude hors bornes', [0, -90.000001, 0]],
    ['hauteur non finie', [0, 0, Number.NaN]],
  ] as const)('rejette une origine WGS84 invalide : %s', (_label, origin) => {
    const invalid = clonedFixture(availableFixture);
    (invalid.frame as Record<string, unknown>).origin_wgs84 = origin;

    expect(() => parseViewerManifest(invalid)).toThrow('frame.origin_wgs84');
  });

  it('produit un résumé sans données issues du fixture de démonstration', () => {
    const summary = toViewerManifestSummary(parseViewerManifest(availableFixture));

    expect(summary.fireId).toBe('FR-83-00042');
    expect(summary.sources).toEqual([]);
    expect(summary.history).toEqual([]);
    expect(summary.journal).toEqual([]);
  });
});

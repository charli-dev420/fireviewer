import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  submitPublicIncidentReport,
  type PublicIncidentReportReceipt,
  type PublicReportCategory,
} from '../../lib/publicIncidentView';
import { PageHero } from './FireWarningBasicPages';
import { PublicIcon, type PublicIconName } from './PublicIcon';
import './firewarning-contributions.css';

const STORAGE_KEY = 'fw:contribution-drafts:v1';
type ContributionKind = 'new-fire' | 'evidence';
type LocationMode = 'place' | 'device' | 'manual';

export interface LocalContributionDraft {
  readonly id: string;
  readonly kind: ContributionKind;
  readonly fireId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: 'local-draft';
  readonly location: { readonly mode: LocationMode; readonly label: string; readonly latitude: string; readonly longitude: string; readonly uncertainty: string };
  readonly observation: { readonly type: string; readonly date: string; readonly time: string; readonly direct: boolean; readonly description: string };
  readonly media: { readonly name: string; readonly type: string; readonly size: number; readonly capturedAt: string; readonly direction: string } | null;
  readonly consent: { readonly processing: boolean; readonly retention: boolean; readonly publicDisplay: boolean; readonly modelDisplay: boolean };
  readonly contactEmail: string;
}

interface FormState {
  locationMode: LocationMode;
  locationLabel: string;
  latitude: string;
  longitude: string;
  uncertainty: string;
  observationType: string;
  observationDate: string;
  observationTime: string;
  direct: boolean;
  description: string;
  media: File | null;
  mediaCapturedAt: string;
  mediaDirection: string;
  consentProcessing: boolean;
  consentRetention: boolean;
  consentPublicDisplay: boolean;
  consentModelDisplay: boolean;
  contactEmail: string;
}

const now = new Date();
const today = now.toISOString().slice(0, 10);

function initialState(): FormState {
  return {
    locationMode: 'place', locationLabel: '', latitude: '', longitude: '', uncertainty: '',
    observationType: '', observationDate: today, observationTime: now.toTimeString().slice(0, 5),
    direct: true, description: '', media: null, mediaCapturedAt: '', mediaDirection: '',
    consentProcessing: false, consentRetention: false, consentPublicDisplay: false,
    consentModelDisplay: false, contactEmail: '',
  };
}

function readDrafts(): LocalContributionDraft[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    return Array.isArray(value) ? value.filter((item): item is LocalContributionDraft => Boolean(item && typeof item === 'object' && 'id' in item)) : [];
  } catch {
    return [];
  }
}

function storeDraft(draft: LocalContributionDraft): void {
  const otherDrafts = readDrafts().filter((item) => item.id !== draft.id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([draft, ...otherDrafts].slice(0, 20)));
}

function deleteDraft(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readDrafts().filter((item) => item.id !== id)));
}

function localId(): string {
  const random = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return 'LOCAL-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + random.toUpperCase();
}

function useLowData(): boolean {
  return useMemo(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('fw:settings') || '{}') as { saveData?: boolean };
      return localStorage.getItem('firewarning-low-data') === 'true' || settings.saveData === true;
    } catch {
      return false;
    }
  }, []);
}

function CompactHeading({ icon, eyebrow, title, description, children }: {
  readonly icon: PublicIconName; readonly eyebrow: string; readonly title: string; readonly description: string; readonly children?: ReactNode;
}) {
  return <header className="fw-flow-heading"><div className="fw-page fw-flow-heading__inner"><span className="fw-flow-heading__icon"><PublicIcon name={icon} size={27} /></span><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p>{children}</div></div></header>;
}

function EmergencyGate({ onContinue }: { readonly onContinue: () => void }) {
  return <section className="fw-emergency-gate" aria-labelledby="emergency-title"><div className="fw-emergency-gate__mark"><PublicIcon name="phone" size={32} /></div><p className="fw-kicker">Avant de continuer</p><h2 id="emergency-title">Danger immédiat ou personnes menacées ?</h2><p>FireWarning ne contacte pas les secours et ne déclenche aucune intervention. Appelez d’abord le 18 ou le 112.</p><div className="fw-emergency-gate__actions"><a className="fw-button fw-button--primary" href="tel:112"><PublicIcon name="phone" size={18} />Appeler le 112</a><button className="fw-button fw-button--outline" type="button" onClick={onContinue}>Je suis en sécurité, continuer<PublicIcon name="arrow" size={17} /></button></div></section>;
}

const steps = ['Localisation', 'Observation', 'Image', 'Description', 'Consentements', 'Vérification'] as const;

function StepProgress({ current }: { readonly current: number }) {
  return <ol className="fw-form-progress" aria-label="Progression du formulaire">{steps.map((label, index) => <li key={label} className={index === current ? 'is-current' : index < current ? 'is-complete' : ''} aria-current={index === current ? 'step' : undefined}><span>{index < current ? <PublicIcon name="check-circle" size={15} /> : index + 1}</span><small>{label}</small></li>)}</ol>;
}

function Field({ label, hint, children }: { readonly label: string; readonly hint?: string; readonly children: ReactNode }) {
  return <label className="fw-form-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function LocationChoice({ value, current, title, text, icon, onChange }: {
  readonly value: LocationMode; readonly current: LocationMode; readonly title: string; readonly text: string; readonly icon: PublicIconName; readonly onChange: (value: LocationMode) => void;
}) {
  return <label className={'fw-form-choice ' + (current === value ? 'is-selected' : '')}><input type="radio" name="location" checked={current === value} onChange={() => onChange(value)} /><PublicIcon name={icon} size={25} /><span><strong>{title}</strong><small>{text}</small></span></label>;
}

function Consent({ checked, onChange, title, text, required = false }: {
  readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly title: string; readonly text: string; readonly required?: boolean;
}) {
  return <label className="fw-consent-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} required={required} /><span><strong>{title}{required ? ' *' : ''}</strong><small>{text}</small></span></label>;
}

function validateStep(step: number, state: FormState): string | null {
  if (step === 0 && state.locationMode === 'place' && state.locationLabel.trim().length < 2) return 'Indiquez une commune, un lieu-dit ou un repère.';
  if (step === 0 && state.locationMode !== 'place' && (!state.latitude || !state.longitude)) return state.locationMode === 'device' ? 'Obtenez votre position avant de continuer.' : 'Indiquez la latitude et la longitude.';
  if (step === 1 && !state.observationType) return 'Sélectionnez le type d’observation.';
  if (step === 1 && (!state.observationDate || !state.observationTime)) return 'Indiquez la date et l’heure de l’observation.';
  if (step === 3 && state.description.trim().length < 20) return 'Décrivez votre observation en au moins 20 caractères.';
  if (step === 4 && !state.consentProcessing) return 'Votre accord de traitement est nécessaire pour préparer cette contribution.';
  return null;
}

function ContributionForm({ kind, fireId }: { readonly kind: ContributionKind; readonly fireId?: string }) {
  const [gatePassed, setGatePassed] = useState(kind === 'evidence');
  const [step, setStep] = useState(0);
  const [state, setState] = useState<FormState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [saved, setSaved] = useState<LocalContributionDraft | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const lowData = useLowData();

  useEffect(() => {
    if (!state.media) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(state.media);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [state.media]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((current) => ({ ...current, [key]: value }));

  const locate = () => {
    if (!navigator.geolocation) { setError('La géolocalisation n’est pas disponible sur cet appareil.'); return; }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition((position) => {
      setState((current) => ({ ...current, locationMode: 'device', latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6), uncertainty: Math.round(position.coords.accuracy).toString() }));
      setLocating(false);
    }, () => { setError('La position n’a pas pu être obtenue. Saisissez un lieu manuellement.'); setLocating(false); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };

  const next = () => {
    const issue = validateStep(step, state);
    if (issue) { setError(issue); return; }
    setError(null); setStep((value) => Math.min(steps.length - 1, value + 1));
  };

  const save = () => {
    const issue = validateStep(4, state);
    if (issue) { setStep(4); setError(issue); return; }
    const timestamp = new Date().toISOString();
    const draft: LocalContributionDraft = {
      id: localId(), kind, fireId: fireId || null, createdAt: timestamp, updatedAt: timestamp, status: 'local-draft',
      location: { mode: state.locationMode, label: state.locationLabel.trim(), latitude: state.latitude, longitude: state.longitude, uncertainty: state.uncertainty },
      observation: { type: state.observationType, date: state.observationDate, time: state.observationTime, direct: state.direct, description: state.description.trim() },
      media: state.media ? { name: state.media.name, type: state.media.type, size: state.media.size, capturedAt: state.mediaCapturedAt, direction: state.mediaDirection } : null,
      consent: { processing: state.consentProcessing, retention: state.consentRetention, publicDisplay: state.consentPublicDisplay, modelDisplay: state.consentModelDisplay },
      contactEmail: state.contactEmail.trim(),
    };
    try { storeDraft(draft); setSaved(draft); setError(null); } catch { setError('Le navigateur a refusé l’enregistrement local. Aucune donnée n’a été transmise.'); }
  };

  if (!gatePassed) return <EmergencyGate onContinue={() => setGatePassed(true)} />;

  if (saved) return <section className="fw-contribution-success" aria-live="polite"><span><PublicIcon name="check-circle" size={31} /></span><p className="fw-kicker">Brouillon enregistré</p><h2>Aucune donnée n’a été transmise</h2><p>Le backend public de contribution n’est pas encore disponible. Le brouillon est conservé uniquement dans ce navigateur, sans le fichier image brut.</p><dl><div><dt>Identifiant local</dt><dd><code>{saved.id}</code></dd></div><div><dt>État</dt><dd>Brouillon local · non transmis</dd></div></dl><div className="fw-form-actions"><a className="fw-button fw-button--primary" href={'/contribution/' + saved.id}>Consulter le brouillon<PublicIcon name="arrow" size={17} /></a><a className="fw-button fw-button--outline" href={fireId ? '/incendie/' + fireId : '/incendies'}>Retour</a></div></section>;

  return <section className="fw-contribution-workspace">
    {kind === 'evidence' ? <aside className="fw-flow-notice"><PublicIcon name="info" size={20} /><span>Cette preuve est préparée pour l’incident <strong>{fireId}</strong>. Elle ne sera jamais publiée automatiquement.</span></aside> : null}
    {lowData ? <aside className="fw-flow-notice is-low-data"><PublicIcon name="data" size={20} /><span>Mode données réduites actif. Aucun média n’est chargé en arrière-plan.</span></aside> : null}
    <StepProgress current={step} />
    <div className="fw-form-panel">
      {step === 0 ? <section aria-labelledby="step-location"><p className="fw-kicker">Étape 1 sur 6</p><h2 id="step-location">Où se trouve l’observation ?</h2><p>La position de l’appareil n’est demandée qu’après votre action.</p><div className="fw-form-choices"><LocationChoice value="place" current={state.locationMode} title="Rechercher un lieu" text="Commune, lieu-dit ou repère" icon="search" onChange={(value) => update('locationMode', value)} /><LocationChoice value="device" current={state.locationMode} title="Utiliser ma position" text="Autorisation ponctuelle" icon="crosshair" onChange={(value) => update('locationMode', value)} /><LocationChoice value="manual" current={state.locationMode} title="Saisir des coordonnées" text="Latitude et longitude" icon="location" onChange={(value) => update('locationMode', value)} /></div>{state.locationMode === 'place' ? <Field label="Commune, lieu-dit ou repère"><input value={state.locationLabel} onChange={(event) => update('locationLabel', event.target.value)} placeholder="Ex. massif de Justin, versant est" autoComplete="off" /></Field> : null}{state.locationMode === 'device' ? <div className="fw-location-box"><button className="fw-button fw-button--outline" type="button" onClick={locate} disabled={locating}>{locating ? 'Localisation…' : 'Obtenir ma position'}</button>{state.latitude ? <span>Position obtenue · précision annoncée ± {state.uncertainty || '—'} m</span> : null}</div> : null}{state.locationMode === 'manual' ? <div className="fw-form-grid"><Field label="Latitude"><input inputMode="decimal" value={state.latitude} onChange={(event) => update('latitude', event.target.value)} placeholder="44.7532" /></Field><Field label="Longitude"><input inputMode="decimal" value={state.longitude} onChange={(event) => update('longitude', event.target.value)} placeholder="5.3701" /></Field><Field label="Incertitude estimée (mètres)" hint="Laissez vide si vous ne savez pas."><input inputMode="numeric" value={state.uncertainty} onChange={(event) => update('uncertainty', event.target.value)} /></Field></div> : null}</section> : null}

      {step === 1 ? <section aria-labelledby="step-observation"><p className="fw-kicker">Étape 2 sur 6</p><h2 id="step-observation">Qu’avez-vous observé ?</h2><div className="fw-form-grid"><Field label="Type d’observation"><select value={state.observationType} onChange={(event) => update('observationType', event.target.value)}><option value="">Choisir…</option><option>Flammes visibles</option><option>Fumée</option><option>Point chaud ou lueur</option><option>Reprise apparente</option><option>Route ou accès concerné</option><option>Autre observation</option></select></Field><Field label="Date"><input type="date" max={today} value={state.observationDate} onChange={(event) => update('observationDate', event.target.value)} /></Field><Field label="Heure"><input type="time" value={state.observationTime} onChange={(event) => update('observationTime', event.target.value)} /></Field></div><Consent checked={state.direct} onChange={(value) => update('direct', value)} title="Je l’ai observé directement" text="Décochez si l’information vous a été rapportée." /></section> : null}

      {step === 2 ? <section aria-labelledby="step-image"><p className="fw-kicker">Étape 3 sur 6</p><h2 id="step-image">Ajouter une image, sans vous mettre en danger</h2><p>L’image est facultative. Ne vous approchez jamais du feu pour prendre une photo.</p><label className="fw-upload-zone"><PublicIcon name="image" size={31} /><strong>{state.media ? state.media.name : 'Choisir une image'}</strong><span>JPG, PNG ou WebP · 15 Mo maximum</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => update('media', event.target.files && event.target.files[0] ? event.target.files[0] : null)} /></label>{preview ? <div className="fw-media-preview"><img src={preview} alt="Aperçu local de l’image sélectionnée" /><button type="button" onClick={() => update('media', null)}>Retirer l’image</button></div> : null}<div className="fw-form-grid"><Field label="Date et heure de prise de vue"><input type="datetime-local" value={state.mediaCapturedAt} onChange={(event) => update('mediaCapturedAt', event.target.value)} /></Field><Field label="Direction approximative"><input value={state.mediaDirection} onChange={(event) => update('mediaDirection', event.target.value)} placeholder="Ex. vers le nord-est" /></Field></div></section> : null}

      {step === 3 ? <section aria-labelledby="step-description"><p className="fw-kicker">Étape 4 sur 6</p><h2 id="step-description">Décrivez uniquement ce que vous avez constaté</h2><Field label="Description factuelle" hint="Évitez les noms, numéros de téléphone et autres données personnelles."><textarea rows={7} maxLength={1500} value={state.description} onChange={(event) => update('description', event.target.value)} placeholder="Indiquez ce qui est visible, depuis quel endroit et dans quelle direction…" /><span className="fw-character-count">{state.description.length} / 1 500</span></Field></section> : null}

      {step === 4 ? <section aria-labelledby="step-consent"><p className="fw-kicker">Étape 5 sur 6</p><h2 id="step-consent">Choisissez précisément vos accords</h2><p>Aucune case n’est cochée par défaut. La publication reste indépendante du traitement.</p><div className="fw-consent-list"><Consent required checked={state.consentProcessing} onChange={(value) => update('consentProcessing', value)} title="Analyser cette contribution" text="Autoriser l’examen de la description, de la position et de l’image éventuelle." /><Consent checked={state.consentRetention} onChange={(value) => update('consentRetention', value)} title="Conserver la preuve après vérification" text="Autorisation distincte de conservation." /><Consent checked={state.consentPublicDisplay} onChange={(value) => update('consentPublicDisplay', value)} title="Afficher l’image sur la page publique" text="Uniquement depuis son marqueur, jamais dans une galerie." /><Consent checked={state.consentModelDisplay} onChange={(value) => update('consentModelDisplay', value)} title="Afficher un marqueur sur le modèle 3D" text="La position peut être généralisée pour protéger les personnes." /></div><Field label="E-mail de contact facultatif"><input type="email" value={state.contactEmail} onChange={(event) => update('contactEmail', event.target.value)} placeholder="vous@exemple.fr" autoComplete="email" /></Field></section> : null}

      {step === 5 ? <section aria-labelledby="step-review"><p className="fw-kicker">Étape 6 sur 6</p><h2 id="step-review">Vérifiez le brouillon</h2><dl className="fw-review-list"><div><dt>Incident</dt><dd>{fireId || 'Nouveau feu à qualifier'}</dd></div><div><dt>Localisation</dt><dd>{state.locationLabel || (state.latitude ? state.latitude + ', ' + state.longitude : 'Non renseignée')}</dd></div><div><dt>Observation</dt><dd>{state.observationType} · {state.observationDate} à {state.observationTime}</dd></div><div><dt>Image</dt><dd>{state.media ? state.media.name + ' (' + Math.ceil(state.media.size / 1024) + ' Ko)' : 'Aucune image'}</dd></div><div><dt>Publication publique</dt><dd>{state.consentPublicDisplay ? 'Autorisée sous réserve de validation' : 'Non autorisée'}</dd></div></dl><aside className="fw-flow-warning"><PublicIcon name="warning" size={22} /><span><strong>Enregistrement local uniquement.</strong> Cette action ne contacte ni FireWarning ni les secours. Le fichier image n’est pas conservé dans le brouillon.</span></aside></section> : null}

      {error ? <p className="fw-form-error" role="alert"><PublicIcon name="warning" size={18} />{error}</p> : null}
      <footer className="fw-form-actions">{step > 0 ? <button className="fw-button fw-button--outline" type="button" onClick={() => { setError(null); setStep((value) => value - 1); }}><PublicIcon name="arrow-left" size={17} />Retour</button> : <a className="fw-button fw-button--outline" href={fireId ? '/incendie/' + fireId : '/'}>Annuler</a>}{step < steps.length - 1 ? <button className="fw-button fw-button--primary" type="button" onClick={next}>Continuer<PublicIcon name="arrow" size={17} /></button> : <button className="fw-button fw-button--primary" type="button" onClick={save}>Enregistrer le brouillon<PublicIcon name="arrow" size={17} /></button>}</footer>
    </div>
  </section>;
}

export function FireWarningReportPage() {
  return <><PageHero visual="report" title="Signaler un feu" description="Transmettez une observation à la communauté. Ce parcours ne déclenche pas l’intervention des secours." /><div className="fw-page fw-standard-page fw-contribution-page"><ContributionForm kind="new-fire" /></div></>;
}

export function FireWarningAddEvidencePage({ fireId }: { readonly fireId: string }) {
  return <><CompactHeading icon="plus-circle" eyebrow="Contribution liée à un incident" title="Ajouter une preuve" description="Ajoutez une observation ou une image à la fiche existante, sans créer un nouvel incendie."><a href={'/incendie/' + fireId}>Retour à l’incident {fireId}</a></CompactHeading><div className="fw-page fw-standard-page fw-contribution-page"><ContributionForm kind="evidence" fireId={fireId} /></div></>;
}

const reportTargets: readonly { value: string; label: string; category: PublicReportCategory }[] = [
  { value: 'zone', label: 'Zone affichée', category: 'location' },
  { value: 'state', label: 'État de l’incident', category: 'information_obsolete' },
  { value: 'text', label: 'Texte ou information', category: 'information_obsolete' },
  { value: 'statistic', label: 'Statistique', category: 'information_obsolete' },
  { value: 'image', label: 'Image ou attribution', category: 'source' },
  { value: 'position', label: 'Position sur le modèle', category: 'location' },
  { value: 'privacy', label: 'Donnée personnelle visible', category: 'privacy' },
  { value: 'accessibility', label: 'Accessibilité', category: 'accessibility' },
  { value: 'technical', label: 'Problème technique', category: 'information_obsolete' },
];

export function FireWarningIncidentErrorPage({ fireId }: { readonly fireId: string }) {
  const [target, setTarget] = useState('text');
  const [description, setDescription] = useState('');
  const [modelLocation, setModelLocation] = useState('');
  const [contact, setContact] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PublicIncidentReportReceipt | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (description.trim().length < 12) { setError('Décrivez le problème en au moins 12 caractères.'); return; }
    if (!consent) { setError('Votre accord de traitement est nécessaire.'); return; }
    const selected = reportTargets.find((item) => item.value === target) || reportTargets[2];
    const parts = ['Élément concerné : ' + selected.label + '.', description.trim(), modelLocation.trim() ? 'Emplacement indiqué : ' + modelLocation.trim() + '.' : '', contact.trim() ? 'Contact facultatif fourni : ' + contact.trim() + '.' : ''].filter(Boolean);
    setBusy(true); setError(null);
    try { setReceipt(await submitPublicIncidentReport(fireId, { category: selected.category, message: parts.join('\n') })); }
    catch { setError('Le signalement n’a pas pu être transmis. Vérifiez votre connexion puis réessayez.'); }
    finally { setBusy(false); }
  };

  return <><CompactHeading icon="warning" eyebrow="Correction d’une fiche publique" title="Signaler une erreur" description="Votre signalement sera examiné. Il ne modifie jamais immédiatement la page publique."><a href={'/incendie/' + fireId}>Retour à l’incident {fireId}</a></CompactHeading><div className="fw-page fw-standard-page fw-contribution-page">{receipt ? <section className="fw-contribution-success" aria-live="polite"><span><PublicIcon name="check-circle" size={31} /></span><p className="fw-kicker">Signalement reçu</p><h2>La page reste inchangée pendant la vérification</h2><p>L’équipe de modération dispose maintenant de votre signalement.</p><dl><div><dt>Identifiant de suivi</dt><dd><code>{receipt.receipt_id}</code></dd></div><div><dt>Reçu le</dt><dd>{new Date(receipt.submitted_at).toLocaleString('fr-FR')}</dd></div></dl><a className="fw-button fw-button--primary" href={'/incendie/' + fireId}>Retour à l’incident</a></section> : <form className="fw-error-report-form" onSubmit={(event) => void submit(event)}><aside className="fw-flow-notice"><PublicIcon name="info" size={20} /><span>Incident concerné : <strong>{fireId}</strong>. Pour ajouter une preuve, utilisez le parcours dédié.</span></aside><section><h2>Quel élément doit être vérifié ?</h2><div className="fw-report-targets">{reportTargets.map((item) => <label key={item.value} className={target === item.value ? 'is-selected' : ''}><input type="radio" name="target" checked={target === item.value} onChange={() => setTarget(item.value)} /><span>{item.label}</span></label>)}</div></section><Field label="Description du problème"><textarea rows={7} minLength={12} maxLength={1800} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Expliquez précisément ce qui semble incorrect." required /></Field><div className="fw-form-grid"><Field label="Emplacement sur le modèle, facultatif"><input value={modelLocation} onChange={(event) => setModelLocation(event.target.value)} placeholder="Ex. marqueur nord-est" /></Field><Field label="Contact facultatif"><input type="email" value={contact} onChange={(event) => setContact(event.target.value)} placeholder="vous@exemple.fr" /></Field></div><Consent required checked={consent} onChange={setConsent} title="Autoriser le traitement de ce signalement" text="Les informations sont utilisées uniquement pour examiner et corriger la fiche." />{error ? <p className="fw-form-error" role="alert"><PublicIcon name="warning" size={18} />{error}</p> : null}<footer className="fw-form-actions"><a className="fw-button fw-button--outline" href={'/incendie/' + fireId}>Annuler</a><button className="fw-button fw-button--primary" type="submit" disabled={busy}>{busy ? 'Transmission…' : 'Transmettre le signalement'}<PublicIcon name="arrow" size={17} /></button></footer></form>}</div></>;
}

export function FireWarningContributionTrackingPage({ contributionId }: { readonly contributionId: string }) {
  const [draft, setDraft] = useState<LocalContributionDraft | null>(() => readDrafts().find((item) => item.id === contributionId) || null);
  const [deleted, setDeleted] = useState(false);
  if (deleted) return <><CompactHeading icon="trash" eyebrow="Contribution locale" title="Brouillon supprimé" description="Les métadonnées de ce brouillon ont été retirées de ce navigateur." /><div className="fw-page fw-standard-page"><a className="fw-button fw-button--primary" href="/signaler">Créer un nouveau signalement</a></div></>;
  if (!draft) return <><CompactHeading icon="search" eyebrow="Suivi d’une contribution" title="Contribution introuvable" description="Aucun brouillon local ne correspond à cet identifiant dans ce navigateur." /><div className="fw-page fw-standard-page fw-contribution-page"><section className="fw-flow-empty"><PublicIcon name="info" size={28} /><h2>Le suivi serveur n’est pas encore disponible</h2><p>Les brouillons ne sont visibles que sur l’appareil où ils ont été enregistrés.</p><a className="fw-button fw-button--primary" href="/signaler">Signaler un feu</a></section></div></>;
  return <><CompactHeading icon="bookmark" eyebrow="Suivi local" title={draft.id} description="Ce brouillon est privé, stocké sur cet appareil et n’a pas été transmis.">{draft.fireId ? <a href={'/incendie/' + draft.fireId}>Voir l’incident {draft.fireId}</a> : null}</CompactHeading><div className="fw-page fw-standard-page fw-contribution-page"><section className="fw-tracking-card"><header><span className="fw-local-status"><PublicIcon name="clock" size={17} />Brouillon local · non transmis</span><small>Mis à jour le {new Date(draft.updatedAt).toLocaleString('fr-FR')}</small></header><dl className="fw-review-list"><div><dt>Type</dt><dd>{draft.kind === 'evidence' ? 'Preuve liée à un incident' : 'Nouveau feu à qualifier'}</dd></div><div><dt>Localisation</dt><dd>{draft.location.label || draft.location.latitude + ', ' + draft.location.longitude}</dd></div><div><dt>Observation</dt><dd>{draft.observation.type} · {draft.observation.date} à {draft.observation.time}</dd></div><div><dt>Image référencée</dt><dd>{draft.media ? draft.media.name + ' · fichier non conservé' : 'Aucune'}</dd></div><div><dt>Affichage public autorisé</dt><dd>{draft.consent.publicDisplay ? 'Oui, après validation' : 'Non'}</dd></div></dl><section><h2>Description</h2><p>{draft.observation.description}</p></section><aside className="fw-flow-warning"><PublicIcon name="warning" size={22} /><span>Supprimer ce brouillon retire uniquement sa copie locale. Il n’a jamais été transmis.</span></aside><footer className="fw-form-actions"><a className="fw-button fw-button--outline" href={draft.fireId ? '/incendie/' + draft.fireId : '/incendies'}>Retour</a><button className="fw-button fw-button--outline" type="button" onClick={() => { deleteDraft(draft.id); setDraft(null); setDeleted(true); }}><PublicIcon name="trash" size={17} />Supprimer le brouillon</button></footer></section></div></>;
}

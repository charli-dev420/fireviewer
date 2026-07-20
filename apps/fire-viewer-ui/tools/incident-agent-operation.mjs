#!/usr/bin/env node

import { resolve } from 'node:path';
import { adminGet, adminPost, authenticateAdmin } from './admin-api-session.mjs';
import { IncidentSourceCorpusError } from './incident-source-corpus.mjs';

const OPERATIONS = new Set(['user_media', 'source_research', 'satellite_media']);

function usage() {
  return [
    'Usage : node tools/incident-agent-operation.mjs --credentials-file <fichier> [--day <YYYY-MM-DD>] [options]',
    '',
    'Options :',
    '  --api-origin <https-url>  Origine API (défaut : https://fireviewer-api.vercel.app).',
    '  --fire-id <id>            Incident cible (défaut : FR-26-00001).',
    '  --run <type>               Déclenche user_media, source_research ou satellite_media.',
    '  --tick-dispatcher           Exécute un passage du dispatcher persistant de production.',
    '  --batch-id <id>            Lit le statut détaillé d’un lot média.',
    '  --research-id <id>         Lit le statut détaillé d’une recherche publique.',
    '  --location <texte>         Localisation utilisée par la recherche publique.',
    'Sans --run, la commande lit seulement l’état des trois opérations.',
  ].join('\n');
}

function parseArguments(argumentsList) {
  const options = {
    apiOrigin: 'https://fireviewer-api.vercel.app',
    fireId: 'FR-26-00001',
    location: 'Die, massif de Justin, Drôme',
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--tick-dispatcher') {
      options.tickDispatcher = true;
      continue;
    }
    if (!['--api-origin', '--fire-id', '--day', '--run', '--batch-id', '--research-id', '--location', '--credentials-file'].includes(argument) || index + 1 >= argumentsList.length) {
      throw new IncidentSourceCorpusError(usage());
    }
    const value = argumentsList[(index += 1)];
    if (argument === '--api-origin') options.apiOrigin = value;
    if (argument === '--fire-id') options.fireId = value;
    if (argument === '--day') options.day = value;
    if (argument === '--run') options.run = value;
    if (argument === '--batch-id') options.batchId = value;
    if (argument === '--research-id') options.researchId = value;
    if (argument === '--location') options.location = value;
    if (argument === '--credentials-file') options.credentialsFile = resolve(value);
  }
  if (!options.credentialsFile) {
    throw new IncidentSourceCorpusError(usage());
  }
  const readsDetailedStatus = Boolean(options.batchId || options.researchId);
  if (!readsDetailedStatus && !options.tickDispatcher && !/^\d{4}-\d{2}-\d{2}$/u.test(options.day ?? '')) {
    throw new IncidentSourceCorpusError(usage());
  }
  if (options.batchId && options.researchId) {
    throw new IncidentSourceCorpusError('Choisir --batch-id ou --research-id, pas les deux.');
  }
  if (readsDetailedStatus && options.run) {
    throw new IncidentSourceCorpusError('Un statut détaillé ne peut pas déclencher une opération.');
  }
  if (options.tickDispatcher && (readsDetailedStatus || options.run)) {
    throw new IncidentSourceCorpusError('--tick-dispatcher doit être utilisé seul.');
  }
  if (!/^FR-[0-9A-Z]{2,3}-[0-9]{5}$/u.test(options.fireId)) {
    throw new IncidentSourceCorpusError('--fire-id est invalide.');
  }
  if (options.run && !OPERATIONS.has(options.run)) {
    throw new IncidentSourceCorpusError('--run doit désigner une opération connue.');
  }
  const origin = new URL(options.apiOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
    throw new IncidentSourceCorpusError('--api-origin doit être une origine HTTPS sans chemin ni identifiants.');
  }
  options.apiOrigin = origin.origin;
  return options;
}

function safeOverview(payload) {
  return {
    fire_id: payload.fire_id,
    episode_id: payload.episode_id,
    local_date: payload.local_date,
    actions: Array.isArray(payload.actions) ? payload.actions.map((action) => ({
      operation_type: action.operation_type,
      pending_files: action.pending_files,
      pending_analyses: action.pending_analyses,
      running_analyses: action.running_analyses,
      last_run_at: action.last_run_at,
      can_run: action.can_run,
      blocked_reason: action.blocked_reason,
    })) : [],
  };
}

try {
  const options = parseArguments(process.argv.slice(2));
  const session = await authenticateAdmin(options.apiOrigin, options.credentialsFile);
  if (options.tickDispatcher) {
    const result = await adminPost(
      options.apiOrigin,
      session,
      '/api/v2/admin/agent-batches/dispatcher/tick',
      {},
      `dispatcher-tick:${Date.now()}`,
    );
    process.stdout.write(`${JSON.stringify({ processed: result.processed === true }, null, 2)}\n`);
  } else if (options.batchId) {
    const result = await adminGet(
      options.apiOrigin,
      session,
      `/api/v2/admin/agent-batches/${encodeURIComponent(options.batchId)}`,
    );
    process.stdout.write(`${JSON.stringify({
      batch_id: result.batch_id,
      fire_id: result.fire_id,
      episode_id: result.episode_id,
      analysis_id: result.analysis_id,
      batch_type: result.batch_type,
      state: result.state,
      submitted_at: result.submitted_at,
      completed_at: result.completed_at,
      item_count: Array.isArray(result.items) ? result.items.length : null,
      dispatch: result.dispatch ? {
        dispatch_id: result.dispatch.dispatch_id,
        state: result.dispatch.state,
        attempt: result.dispatch.attempt,
        poll_count: result.dispatch.poll_count,
        remote_status: result.dispatch.remote_status,
        submitted_at: result.dispatch.submitted_at,
        completed_at: result.dispatch.completed_at,
        last_error_code: result.dispatch.last_error_code,
      } : null,
    }, null, 2)}\n`);
  } else if (options.researchId) {
    const result = await adminGet(
      options.apiOrigin,
      session,
      `/api/v2/admin/agent-batches/source-research/${encodeURIComponent(options.researchId)}`,
    );
    process.stdout.write(`${JSON.stringify({
      research_id: result.research_id,
      fire_id: result.fire_id,
      episode_id: result.episode_id,
      state: result.state,
      local_date: result.local_date,
      queued_at: result.queued_at,
      started_at: result.started_at,
      completed_at: result.completed_at,
      candidate_count: Array.isArray(result.candidates) ? result.candidates.length : null,
      batch_ids: result.batch_ids ?? [],
      failure_code: result.failure_code,
    }, null, 2)}\n`);
  } else if (options.run) {
    const result = await adminPost(
      options.apiOrigin,
      session,
      `/api/v2/admin/agent-batches/incidents/${encodeURIComponent(options.fireId)}/operations/${options.run}/run`,
      { local_date: options.day, location_hint: options.location },
      `campaign:${options.fireId}:${options.day}:${options.run}:v1`,
    );
    process.stdout.write(`${JSON.stringify({
      fire_id: result.fire_id,
      episode_id: result.episode_id,
      operation_type: result.operation_type,
      operation_ids: result.operation_ids,
      queued_files: result.queued_files,
    }, null, 2)}\n`);
  } else {
    const overview = await adminGet(
      options.apiOrigin,
      session,
      `/api/v2/admin/agent-batches/incidents/${encodeURIComponent(options.fireId)}/operations?local_date=${encodeURIComponent(options.day)}`,
    );
    process.stdout.write(`${JSON.stringify(safeOverview(overview), null, 2)}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Opération IA refusée : ${message}\n`);
  process.exitCode = 1;
}

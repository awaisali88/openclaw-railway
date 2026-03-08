// src/lib/memory-setup.js
// Initializes the 3-layer memory workspace for the planner/coder/designer pipeline.
//
// Layer 1 — Session:   memory/YYYY-MM-DD.md  (daily log, per-agent)
// Layer 2 — Project:   PROJECT.md            (shared handoff file, all agents)
// Layer 3 — Long-term: MEMORY.md             (durable facts, all agents)

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const WORKSPACE = process.env.OPENCLAW_WORKSPACE_DIR || '/data/workspace';

const BOOTSTRAP_FILES = {
  'MEMORY.md': `# Long-Term Memory

## About This System
<!-- Fill in your platform name, stack, and key details here -->

## Persistent Architecture Decisions
<!-- Agents: append durable decisions here. Date + one-line summary format. -->

## Lessons Learned
<!-- Agents: append important lessons here. -->

## Preferences & Conventions
<!-- Agents: append coding/design/planning preferences here. -->
`,

  'PROJECT.md': `# Current Project Brief

> Shared working memory for planner, coder, and designer agents.
> Injected into every agent session automatically.
> Any agent may update it. The next agent reads the updated version.

## Project Name
<!-- Set by planner agent at project start -->

## Objective
<!-- What are we building? One paragraph. -->

## Current Status
<!-- planning / coding / designing / done -->

## Planner Output
<!-- Populated by planner agent: architecture decisions, task breakdown, constraints. -->

## Coder Output
<!-- Populated by coder agent: what was built, file paths, key implementation notes. -->

## Designer Output
<!-- Populated by designer agent: design decisions, assets created, UI notes. -->

## Blockers
<!-- Any agent may write here if human input is needed. -->

## Completed
<!-- Tick items off here when done. -->
`,

  'AGENTS.md': `# Agent Operating Rules

## Every Session — Do This First
1. Read PROJECT.md — current project brief shared by all agents
2. Read MEMORY.md — long-term facts and architecture decisions
3. Read memory/YYYY-MM-DD.md (today + yesterday) for recent session context
4. Check PROJECT.md "Current Status" to know where we are in the pipeline

## Memory Writing Rules
- Durable decisions → MEMORY.md
- Project-specific work → PROJECT.md (your agent's section)
- Day-to-day notes → memory/YYYY-MM-DD.md
- Never keep important info only in RAM — write it to disk

## Pipeline Sequence
1. Planner — analyzes requirements, writes plan to PROJECT.md "Planner Output"
2. Coder — reads planner output, implements, writes to PROJECT.md "Coder Output"
3. Designer — reads coder output, creates UI/assets, writes to PROJECT.md "Designer Output"

Each agent must update PROJECT.md "Current Status" before finishing.
`,
};

function ensureMemoryDir() {
  const memDir = join(WORKSPACE, 'memory');
  if (!existsSync(memDir)) {
    mkdirSync(memDir, { recursive: true });
    console.log('[memory-setup] Created memory/ directory');
  }
}

function createIfMissing(filename, content) {
  const filePath = join(WORKSPACE, filename);
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    console.log(`[memory-setup] Created ${filename}`);
  } else {
    console.log(`[memory-setup] ${filename} already exists — skipping`);
  }
}

export function setupMemory() {
  if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });
  ensureMemoryDir();
  Object.entries(BOOTSTRAP_FILES).forEach(([filename, content]) => {
    createIfMissing(filename, content);
  });
  console.log('[memory-setup] 3-layer memory workspace initialized');
}

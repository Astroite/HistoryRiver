PRAGMA foreign_keys = ON;

CREATE TABLE dataset_manifest (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  start_year INTEGER NOT NULL CHECK (start_year <> 0),
  end_year INTEGER NOT NULL CHECK (end_year <> 0),
  historical_year_convention TEXT NOT NULL CHECK (historical_year_convention = 'signed-no-year-zero'),
  selection_policy TEXT NOT NULL
) STRICT;

CREATE TABLE eras (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  start_year INTEGER NOT NULL CHECK (start_year <> 0),
  end_year INTEGER NOT NULL CHECK (end_year <> 0),
  era_order INTEGER NOT NULL UNIQUE,
  target_people INTEGER NOT NULL CHECK (target_people >= 0),
  coverage_note TEXT NOT NULL,
  CHECK (end_year >= start_year)
) STRICT;

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  creator TEXT NOT NULL,
  publisher TEXT NOT NULL,
  locator TEXT NOT NULL,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('primary', 'scholarly', 'reference', 'institutional')),
  accessed_at TEXT NOT NULL
) STRICT;

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_z REAL NOT NULL,
  uncertainty REAL NOT NULL CHECK (uncertainty >= 0 AND uncertainty <= 1),
  note TEXT NOT NULL
) STRICT;

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  era_id TEXT NOT NULL REFERENCES eras(id),
  birth_year INTEGER CHECK (birth_year IS NULL OR birth_year <> 0),
  death_year INTEGER CHECK (death_year IS NULL OR death_year <> 0),
  trajectory_start_year INTEGER NOT NULL CHECK (trajectory_start_year <> 0),
  trajectory_end_year INTEGER NOT NULL CHECK (trajectory_end_year <> 0),
  chronology_status TEXT NOT NULL CHECK (chronology_status IN ('attested', 'estimated', 'disputed', 'traditional')),
  domains_json TEXT NOT NULL,
  selection_reason TEXT NOT NULL,
  visual_weight REAL NOT NULL CHECK (visual_weight >= 0 AND visual_weight <= 1),
  CHECK (trajectory_end_year >= trajectory_start_year)
) STRICT;

CREATE INDEX people_by_era ON people(era_id);

CREATE TABLE person_aliases (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  PRIMARY KEY (person_id, alias)
) STRICT;

CREATE TABLE person_sources (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  PRIMARY KEY (person_id, source_id)
) STRICT;

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  start_year INTEGER NOT NULL CHECK (start_year <> 0),
  end_year INTEGER NOT NULL CHECK (end_year <> 0),
  location_id TEXT REFERENCES locations(id),
  summary TEXT NOT NULL,
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('direct', 'corroborated', 'inferred', 'contested', 'traditional')),
  CHECK (end_year >= start_year)
) STRICT;

CREATE INDEX observations_by_person_year ON observations(person_id, start_year, end_year);

CREATE TABLE observation_sources (
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  PRIMARY KEY (observation_id, source_id)
) STRICT;

CREATE TABLE interpolation_rules (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  from_observation_id TEXT NOT NULL REFERENCES observations(id),
  to_observation_id TEXT NOT NULL REFERENCES observations(id),
  start_year INTEGER NOT NULL CHECK (start_year <> 0),
  end_year INTEGER NOT NULL CHECK (end_year <> 0),
  method TEXT NOT NULL CHECK (method = 'linear'),
  uncertainty REAL NOT NULL CHECK (uncertainty >= 0 AND uncertainty <= 1),
  note TEXT NOT NULL,
  CHECK (end_year >= start_year)
) STRICT;

CREATE TABLE person_years (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  historical_year INTEGER NOT NULL CHECK (historical_year <> 0),
  year_index INTEGER NOT NULL CHECK (year_index >= 0),
  life_state TEXT NOT NULL CHECK (life_state IN ('active', 'possibly-active', 'outside-range', 'unknown')),
  location_id TEXT,
  position_x REAL,
  position_z REAL,
  derivation TEXT NOT NULL CHECK (derivation IN ('attested', 'bounded', 'interpolated', 'unknown')),
  observation_refs_json TEXT NOT NULL,
  interpolation_rule_id TEXT REFERENCES interpolation_rules(id),
  uncertainty REAL NOT NULL CHECK (uncertainty >= 0 AND uncertainty <= 1),
  UNIQUE (person_id, year_index),
  UNIQUE (person_id, historical_year),
  CHECK ((location_id IS NULL AND position_x IS NULL AND position_z IS NULL) OR
         (location_id IS NOT NULL AND position_x IS NOT NULL AND position_z IS NOT NULL)),
  CHECK ((derivation = 'unknown' AND location_id IS NULL) OR
         (derivation <> 'unknown' AND location_id IS NOT NULL)),
  CHECK ((derivation = 'interpolated' AND interpolation_rule_id IS NOT NULL) OR
         (derivation <> 'interpolated' AND interpolation_rule_id IS NULL))
) STRICT;

CREATE INDEX person_years_by_person ON person_years(person_id, year_index);
CREATE INDEX person_years_by_year ON person_years(year_index, person_id);

CREATE TABLE year_slices (
  historical_year INTEGER PRIMARY KEY CHECK (historical_year <> 0),
  year_index INTEGER NOT NULL UNIQUE CHECK (year_index >= 0),
  coverage TEXT NOT NULL CHECK (coverage IN ('curated', 'partial', 'empty', 'unreviewed')),
  dataset_version TEXT NOT NULL
) STRICT;

CREATE TABLE year_slice_members (
  year_index INTEGER NOT NULL REFERENCES year_slices(year_index) ON DELETE CASCADE,
  person_year_id TEXT NOT NULL REFERENCES person_years(id) ON DELETE CASCADE,
  PRIMARY KEY (year_index, person_year_id)
) STRICT;

CREATE INDEX year_slice_members_by_person_year ON year_slice_members(person_year_id);

PRAGMA user_version = 1;

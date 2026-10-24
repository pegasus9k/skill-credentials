CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP VIEW  IF EXISTS student_skill_totals    CASCADE;
DROP VIEW  IF EXISTS student_portfolio       CASCADE;
DROP TABLE IF EXISTS mock_academic_records   CASCADE;
DROP TABLE IF EXISTS grade_records           CASCADE;
DROP TABLE IF EXISTS team_members            CASCADE;
DROP TABLE IF EXISTS project_teams           CASCADE;
DROP TABLE IF EXISTS project_slots           CASCADE;
DROP TABLE IF EXISTS projects                CASCADE;
DROP TABLE IF EXISTS path_applications       CASCADE;
DROP TABLE IF EXISTS competency_paths        CASCADE;
DROP TABLE IF EXISTS student_competencies    CASCADE;
DROP TABLE IF EXISTS student_badges          CASCADE;
DROP TABLE IF EXISTS node_prerequisites      CASCADE;
DROP TABLE IF EXISTS node_thresholds         CASCADE;
DROP TABLE IF EXISTS nodes                   CASCADE;
DROP TABLE IF EXISTS badge_skills            CASCADE;
DROP TABLE IF EXISTS badges                  CASCADE;
DROP TABLE IF EXISTS auth_sessions           CASCADE;
DROP TABLE IF EXISTS auth_nonces             CASCADE;
DROP TABLE IF EXISTS third_party_ids         CASCADE;
DROP TABLE IF EXISTS student_ids             CASCADE;
DROP TABLE IF EXISTS seasons                 CASCADE;
DROP TABLE IF EXISTS indexer_state           CASCADE;
DROP TABLE IF EXISTS skill_types             CASCADE;
-- Tables of earlier versions, so the file recreates a database from any earlier state.
DROP TABLE IF EXISTS students                CASCADE;
DROP TABLE IF EXISTS metadata_payloads       CASCADE;
DROP TABLE IF EXISTS skill_esco_mappings     CASCADE;
DROP TABLE IF EXISTS skill_dimensions        CASCADE;

-- The skill reference list, from simulation/spec/skillTypes.json.
-- Written only by backend/setup.js (yarn backend:setup).
CREATE TABLE skill_types (
    skill_id          VARCHAR(66)  PRIMARY KEY, -- keccak256(code), as ethers.id(code)
    code              VARCHAR(20)  NOT NULL UNIQUE, -- "GRID", "PWR", "DL", etc.
    label             VARCHAR(200) NOT NULL,
    learning_outcomes TEXT[]       NOT NULL
);


-- Ledger view. Only the event indexer (indexer/indexer.js) writes
-- these tables, from the events and view functions of SkillBadge, SkillGraph
-- and SkillPath, and from the metadata documents. Every row carries the block number and block
-- time of the event that wrote it, never NOW(). The document columns stay NULL
-- when the document does not match the hash on the ledger.

-- The last block the indexer handled, written in the same transaction as the
-- rows of its block range. One row.
CREATE TABLE indexer_state (
    id                  BOOLEAN  PRIMARY KEY DEFAULT TRUE CHECK (id),
    last_block          INTEGER  NOT NULL,
    document_mismatches INTEGER  NOT NULL DEFAULT 0, -- documents missing, or not matching the hash on the ledger
    season_mismatches   INTEGER  NOT NULL DEFAULT 0  -- season labels whose keccak256 is not the season ID
);

-- One row per season, from its first definition. The label comes from the
-- documents, academicYear + "-S" + number, and its keccak256 is the season ID.
CREATE TABLE seasons (
    season_id           VARCHAR(66)  PRIMARY KEY, -- keccak256("2025/2026-S1")
    season_label        VARCHAR(20),              -- "2025/2026-S1"
    badges_frozen_block INTEGER,                  -- SeasonFrozen of SkillBadge, NULL until frozen
    badges_frozen_at    TIMESTAMPTZ,
    nodes_frozen_block  INTEGER,                  -- SeasonFrozen of SkillGraph, NULL until frozen
    nodes_frozen_at     TIMESTAMPTZ
);

CREATE TABLE badges (
    token_id        INTEGER      PRIMARY KEY, -- matches nextTokenId on-chain
    season_id       VARCHAR(66)  NOT NULL REFERENCES seasons(season_id),
    course_id       VARCHAR(66)  NOT NULL, -- keccak256(course code)
    badge_code      VARCHAR(66)  NOT NULL, -- keccak256(spec ID)
    metadata_cid    VARCHAR(66)  NOT NULL, -- SHA-256 of the document, as on the ledger
    spec_id         VARCHAR(20),           -- document: "COSE-2"
    badge_name      VARCHAR(200),          -- document: "Dispatch and Scheduling"
    description     TEXT,                  -- document: the content of the assessment
    course_code     VARCHAR(20),           -- document: "COSE"
    course_name     VARCHAR(200),          -- document
    assessment      VARCHAR(100),          -- document: "Test 2"
    defined_block   INTEGER      NOT NULL,
    defined_at      TIMESTAMPTZ  NOT NULL,
    updated_block   INTEGER,               -- the last BadgeUpdated, NULL if never corrected
    updated_at      TIMESTAMPTZ
);
CREATE INDEX idx_badges_season ON badges(season_id);
CREATE INDEX idx_badges_course ON badges(course_id);

CREATE TABLE badge_skills (
    token_id        INTEGER      NOT NULL REFERENCES badges(token_id),
    skill_id        VARCHAR(66)  NOT NULL,
    points          SMALLINT     NOT NULL CHECK (points > 0),
    PRIMARY KEY (token_id, skill_id)
);
CREATE INDEX idx_badge_skills_skill ON badge_skills(skill_id);

CREATE TABLE nodes (
    node_id         INTEGER      PRIMARY KEY,
    season_id       VARCHAR(66)  NOT NULL REFERENCES seasons(season_id),
    node_code       VARCHAR(66)  NOT NULL, -- keccak256(node name)
    metadata_cid    VARCHAR(66)  NOT NULL, -- SHA-256 of the document, as on the ledger
    version_of      INTEGER      NOT NULL, -- as the ledger holds it: the node's own ID for an original
    node_name       VARCHAR(200),          -- document: "Smart Energy Architect"
    tier            VARCHAR(20),           -- document: Fundamentals, Specialist or Architect
    description     TEXT,                  -- document
    defined_block   INTEGER      NOT NULL,
    defined_at      TIMESTAMPTZ  NOT NULL,
    updated_block   INTEGER,               -- the last NodeUpdated, NULL if never corrected
    updated_at      TIMESTAMPTZ
);
CREATE INDEX idx_nodes_season ON nodes(season_id);

CREATE TABLE node_thresholds (
    node_id         INTEGER      NOT NULL REFERENCES nodes(node_id),
    skill_id        VARCHAR(66)  NOT NULL,
    min_points      SMALLINT     NOT NULL CHECK (min_points > 0),
    PRIMARY KEY (node_id, skill_id)
);
CREATE INDEX idx_node_thresholds_skill ON node_thresholds(skill_id);

-- The prerequisite groups of a node, as getPrerequisiteGroups gives them.
-- A student meets them by holding every node of any one group. A node with no
-- groups is a base node.
CREATE TABLE node_prerequisites (
    node_id              INTEGER  NOT NULL REFERENCES nodes(node_id),
    group_index          SMALLINT NOT NULL, -- from 0, in ledger order
    prerequisite_node_id INTEGER  NOT NULL REFERENCES nodes(node_id),
    PRIMARY KEY (node_id, group_index, prerequisite_node_id)
);
CREATE INDEX idx_node_prereqs_prereq ON node_prerequisites(prerequisite_node_id);

CREATE TABLE student_badges (
    wallet_address    VARCHAR(42)  NOT NULL,
    token_id          INTEGER      NOT NULL REFERENCES badges(token_id),
    grade_commitment  VARCHAR(66)  NOT NULL,
    committed_to_node INTEGER      NOT NULL DEFAULT 0, -- 0 = free, else the node it unlocked
    minted_block      INTEGER      NOT NULL,
    minted_at         TIMESTAMPTZ  NOT NULL,           -- block time
    PRIMARY KEY (wallet_address, token_id)
);
-- "all of Ana's badges":
CREATE INDEX idx_student_badges_wallet ON student_badges(wallet_address); 

-- partial index: only indexes unallocated badges -> makes the "available badges" query fast:
CREATE INDEX idx_student_badges_free   ON student_badges(wallet_address) WHERE committed_to_node = 0;

-- The competencies of each student, with the badges getNodeBadges gives. The
-- indexer reads the badge IDs from the NodeUnlocked event.
CREATE TABLE student_competencies (
    wallet_address  VARCHAR(42)  NOT NULL,
    node_id         INTEGER      NOT NULL REFERENCES nodes(node_id),
    badge_ids       INTEGER[]    NOT NULL, -- array storing the full provenance trail.
    unlocked_block  INTEGER      NOT NULL,
    unlocked_at     TIMESTAMPTZ  NOT NULL, -- block time
    PRIMARY KEY (wallet_address, node_id)
);
CREATE INDEX idx_student_competencies_wallet ON student_competencies(wallet_address);

-- The competency paths and projects the third parties post, the applications
-- of the students, and the teams they form.
CREATE TABLE competency_paths (
    path_id        INTEGER      PRIMARY KEY,
    owner          VARCHAR(42)  NOT NULL, -- the third party's wallet
    status         VARCHAR(7)   NOT NULL CHECK (status IN ('pending', 'open', 'closed')),
    node_ids       INTEGER[]    NOT NULL, -- every node is required
    metadata_cid   VARCHAR(66)  NOT NULL, -- SHA-256 of the document, as on the ledger
    name           VARCHAR(200),          -- document
    description    TEXT,                  -- document
    third_party    VARCHAR(200),          -- document: the third party, as the post names it
    defined_block  INTEGER      NOT NULL,
    defined_at     TIMESTAMPTZ  NOT NULL,
    updated_block  INTEGER,               -- the last PathApproved or PathClosed
    updated_at     TIMESTAMPTZ
);

CREATE TABLE path_applications (
    path_id        INTEGER      NOT NULL REFERENCES competency_paths(path_id),
    wallet_address VARCHAR(42)  NOT NULL,
    applied_at     TIMESTAMPTZ  NOT NULL, -- the ledger's timestamp, from getPathApplication
    applied_block  INTEGER      NOT NULL,
    PRIMARY KEY (path_id, wallet_address)
);

CREATE TABLE projects (
    project_id     INTEGER      PRIMARY KEY,
    owner          VARCHAR(42)  NOT NULL, -- the third party's wallet
    status         VARCHAR(7)   NOT NULL CHECK (status IN ('pending', 'open', 'started', 'closed')),
    max_teams      SMALLINT     NOT NULL, -- most teams the owner can select
    selected_count SMALLINT     NOT NULL,
    metadata_cid   VARCHAR(66)  NOT NULL, -- SHA-256 of the document, as on the ledger
    name           VARCHAR(200),          -- document
    description    TEXT,                  -- document
    third_party    VARCHAR(200),          -- document: the third party, as the post names it
    defined_block  INTEGER      NOT NULL,
    defined_at     TIMESTAMPTZ  NOT NULL,
    updated_block  INTEGER,               -- the last ProjectApproved, TeamSelected, ProjectStarted or ProjectClosed
    updated_at     TIMESTAMPTZ
);

-- One slot per role. A student takes a slot by holding every node of it.
CREATE TABLE project_slots (
    project_id     INTEGER      NOT NULL REFERENCES projects(project_id),
    slot           SMALLINT     NOT NULL, -- from 0, as the contract. The documents number slots from 1
    node_ids       INTEGER[]    NOT NULL,
    PRIMARY KEY (project_id, slot)
);

CREATE TABLE project_teams (
    team_id        INTEGER      PRIMARY KEY,
    project_id     INTEGER      NOT NULL REFERENCES projects(project_id),
    formed         BOOLEAN      NOT NULL, -- every slot taken. The team no longer changes
    selected       BOOLEAN      NOT NULL, -- chosen by the owner of the project
    started_block  INTEGER      NOT NULL,
    started_at     TIMESTAMPTZ  NOT NULL,
    updated_block  INTEGER,               -- the last SlotFilled, SlotLeft, TeamFormed or TeamSelected
    updated_at     TIMESTAMPTZ
);

CREATE TABLE team_members (
    team_id        INTEGER      NOT NULL REFERENCES project_teams(team_id),
    slot           SMALLINT     NOT NULL, -- from 0, as the contract
    wallet_address VARCHAR(42)  NOT NULL,
    PRIMARY KEY (team_id, slot)
);

-- Private tables. The indexer never writes them, and no foreign key
-- points into the ledger view: the grades of the institution never wait for
-- the indexer.

-- The identity FenixEdu confirmed for each student wallet, and its master salt.
CREATE TABLE student_ids (
    wallet_address    VARCHAR(42)  PRIMARY KEY,
    fenix_id          VARCHAR(20)  UNIQUE, -- one wallet per FenixEdu username
    student_name      VARCHAR(200) NOT NULL,
    email             VARCHAR(200),
    degree            VARCHAR(20)  DEFAULT 'MEEC',
    master_salt       TEXT,
    registered_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login_at     TIMESTAMPTZ,
    on_chain_tx_hash  VARCHAR(66),
    status            VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'))
);

-- The organization behind each third party wallet.
CREATE TABLE third_party_ids (
    wallet_address  VARCHAR(42)  PRIMARY KEY,
    nif             VARCHAR(9)   NOT NULL UNIQUE, -- one wallet per NIF
    name            VARCHAR(200) NOT NULL,
    registered_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Registration. A nonce, issued by GET /auth/nonce, serves one signed
-- message within 10 minutes. A session holds the identity FenixEdu confirmed
-- until the wallet signature arrives from the same browser.
CREATE TABLE auth_nonces (
    nonce           VARCHAR(64)  PRIMARY KEY,
    issued_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    used_at         TIMESTAMPTZ
);

CREATE TABLE auth_sessions (
    session_id      VARCHAR(64)  PRIMARY KEY, -- the session cookie
    fenix_username  VARCHAR(20)  NOT NULL,
    student_name    VARCHAR(200) NOT NULL,    -- as FenixEdu gives them, for the record of step 3
    email           VARCHAR(200),
    expires_at      TIMESTAMPTZ  NOT NULL
);

-- Private vault: raw grades and per-badge salts for grade commitment verification.
-- Written by the Oracle pipeline (server.js), NOT by the indexer.
CREATE TABLE grade_records (
    wallet_address  VARCHAR(42)  NOT NULL REFERENCES student_ids(wallet_address),
    token_id        INTEGER      NOT NULL,
    raw_grade       SMALLINT     NOT NULL CHECK (raw_grade BETWEEN 0 AND 20),
    badge_salt      TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (wallet_address, token_id)
);

CREATE TABLE mock_academic_records (
    fenix_id        VARCHAR(20)  NOT NULL,
    token_id        INTEGER      NOT NULL,
    raw_grade       SMALLINT     NOT NULL CHECK (raw_grade BETWEEN 0 AND 20),
    published_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    processed       BOOLEAN      NOT NULL DEFAULT FALSE,
    processed_at    TIMESTAMPTZ,
    PRIMARY KEY (fenix_id, token_id)
);
CREATE INDEX idx_mock_unprocessed ON mock_academic_records(processed) WHERE processed = FALSE;

CREATE VIEW student_portfolio AS
SELECT
    sb.wallet_address, -- which student
    sb.token_id,       -- which badge
    b.badge_name,      -- what it's called
    b.course_name,     -- which course
    b.assessment,      -- "Test 2", "Project 1, deliverable 1"
    sb.grade_commitment, -- the on-chain hash (opaque to frontend)
    sb.committed_to_node, -- 0 = free, or the node ID it's locked to
    CASE WHEN sb.committed_to_node = 0 -- converting a number to a word: frontend reads allocation_status instead of raw integer
         THEN 'free'  
         ELSE 'committed' 
    END AS allocation_status, 
    sb.minted_at, -- when the badge was minted to the student
    -- For each row in the main query (one badge), this runs a mini-query to find all skills for that badge:
    (SELECT json_agg(   
                json_build_object( -- builds one JSON object per skill row
                    'skill_id', bs.skill_id,
                    'code', COALESCE(st.code, 'UNKNOWN'),
                    'points', bs.points) ORDER BY bs.skill_id
                    )
    FROM badge_skills bs LEFT JOIN skill_types st ON bs.skill_id = st.skill_id
    WHERE bs.token_id = sb.token_id) AS skills

FROM student_badges sb JOIN badges b ON sb.token_id = b.token_id;

CREATE VIEW student_skill_totals AS
SELECT
    sb.wallet_address, bs.skill_id,
    COALESCE(st.code, 'UNKNOWN') AS code,
    SUM(bs.points) AS total_points, -- total across ALL badges
    COUNT(DISTINCT sb.token_id) AS badge_count -- how many badges contributed
FROM student_badges sb
JOIN badge_skills bs ON sb.token_id = bs.token_id -- link badges to their skills
LEFT JOIN skill_types st ON bs.skill_id = st.skill_id -- resolve codes
GROUP BY sb.wallet_address, bs.skill_id, st.code;
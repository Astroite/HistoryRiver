"use client";

import { useMemo, useState } from "react";

import {
  derivationLabel,
  summarizePersonEvidence,
  type PersonIsolationMode,
} from "@/app/history-person-threads";
import {
  formatHistoricalYear,
  historicalYearToIndex,
  RIVER_START_YEAR,
  CONTENT_END_YEAR,
  type RenderEraRecord,
  type RenderHistoryDataset,
  type RenderPersonRecord,
} from "@/lib/history/model";

const DOMAIN_LABELS: Record<RenderPersonRecord["domain"], string> = {
  thought: "思想",
  statecraft: "治道",
  military: "兵戎",
  culture: "文脉",
  craft: "技艺",
};

const CHRONOLOGY_LABELS: Record<RenderPersonRecord["chronologyStatus"], string> = {
  traditional: "传统纪年",
  estimated: "估计纪年",
  disputed: "争议纪年",
  attested: "实证纪年",
};

function formatYearSpan(startYear: number, endYear: number): string {
  if (startYear === endYear) return formatHistoricalYear(startYear);
  return `${formatHistoricalYear(startYear)} — ${formatHistoricalYear(endYear)}`;
}

function formatLifeYears(person: RenderPersonRecord): string {
  if (person.birthYear === null && person.deathYear === null) return "生卒不详";
  const birth = person.birthYear === null ? "？" : formatHistoricalYear(person.birthYear);
  const death = person.deathYear === null ? "？" : formatHistoricalYear(person.deathYear);
  return `${birth} — ${death}`;
}

function eraFraction(year: number): number {
  const index = historicalYearToIndex(year, RIVER_START_YEAR);
  const endIndex = historicalYearToIndex(CONTENT_END_YEAR, RIVER_START_YEAR);
  return Math.min(1, Math.max(0, index / endIndex));
}

function HistoryPrologue({
  data,
  onClose,
}: {
  data: RenderHistoryDataset;
  onClose: () => void;
}) {
  return (
    <div className="history-prologue" role="dialog" aria-label="落九川序章">
      <div className="history-prologue-inner">
        <div className="history-prologue-title-block">
          <h1 className="history-prologue-title">落九川</h1>
          <span className="history-seal" aria-hidden="true">川</span>
        </div>
        <p className="history-prologue-subtitle">中国历史长河 · 数据艺术</p>
        <p className="history-prologue-inscription">
          河自云上来。上起传说之年，下迄一九四九。
          <br />
          {data.manifest.personCount} 人，{data.manifest.personYearCount.toLocaleString("zh-CN")}
          {" "}个春秋，各为一缕丝线，落入人民的光海。
        </p>
        <button type="button" className="history-prologue-enter" onClick={onClose}>
          沿河而下
        </button>
        <p className="history-prologue-hint">
          左键拖拽环流长河 · 滚轮推拉近观 · 点取一缕丝线识其人
        </p>
      </div>
    </div>
  );
}

function HistoryEraRail({
  eras,
  currentYear,
  onEraSelect,
}: {
  eras: RenderEraRecord[];
  currentYear: number | null;
  onEraSelect: (era: RenderEraRecord) => void;
}) {
  const ordered = useMemo(() => [...eras].sort((a, b) => a.order - b.order), [eras]);
  const markerFraction = currentYear === null ? null : eraFraction(currentYear);
  return (
    <nav className="history-era-rail" aria-label="纪年轴">
      <div className="history-era-track">
        {ordered.map((era) => {
          const active = currentYear !== null
            && currentYear >= era.startYear
            && currentYear <= era.endYear;
          return (
            <button
              key={era.id}
              type="button"
              className={`history-era-segment${active ? " is-active" : ""}`}
              style={{ flexGrow: era.endYear - era.startYear + 1 }}
              onClick={() => onEraSelect(era)}
              aria-current={active ? "true" : undefined}
            >
              <span className="history-era-label">{era.label}</span>
              <span className="history-era-years">
                {formatYearSpan(era.startYear, era.endYear)}
              </span>
            </button>
          );
        })}
        {markerFraction !== null && currentYear !== null ? (
          <div
            className="history-era-marker"
            style={{ top: `${markerFraction * 100}%` }}
            aria-hidden="true"
          >
            <span className="history-era-marker-line" />
            <span className="history-era-marker-year">
              {formatHistoricalYear(currentYear)}
            </span>
          </div>
        ) : null}
      </div>
      <p className="history-era-caption">纪年轴 · 上溯远古 下入今海</p>
    </nav>
  );
}

function HistoryPersonTooltip({
  person,
  position,
}: {
  person: RenderPersonRecord;
  position: { x: number; y: number };
}) {
  return (
    <div
      className="history-person-tooltip"
      style={{ left: position.x + 18, top: position.y + 14 }}
      aria-hidden="true"
    >
      <strong>{person.canonicalName}</strong>
      <span>{DOMAIN_LABELS[person.domain]}</span>
      <span>{formatYearSpan(person.trajectoryStartYear, person.trajectoryEndYear)}</span>
    </div>
  );
}

function HistoryPersonCard({
  data,
  personIndex,
  isolationMode,
  onIsolationModeChange,
  onFocus,
  onClose,
}: {
  data: RenderHistoryDataset;
  personIndex: number;
  isolationMode: PersonIsolationMode;
  onIsolationModeChange: (mode: PersonIsolationMode) => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  const person = data.people[personIndex];
  const era = data.eras.find((item) => item.id === person.eraId);
  const evidence = useMemo(
    () => summarizePersonEvidence(data, personIndex),
    [data, personIndex],
  );
  return (
    <aside className="history-person-card" aria-label={`人物志 · ${person.canonicalName}`}>
      <header className="history-person-card-header">
        <div className="history-person-card-names">
          <h2>{person.canonicalName}</h2>
          {person.aliases.length > 0 ? (
            <p className="history-person-card-aliases">{person.aliases.join(" · ")}</p>
          ) : null}
        </div>
        <span className="history-seal history-seal-small" aria-hidden="true">
          {person.canonicalName.slice(0, 1)}
        </span>
      </header>
      <dl className="history-person-card-meta">
        <div>
          <dt>时代</dt>
          <dd>{era?.label ?? "未编年"}</dd>
        </div>
        <div>
          <dt>领域</dt>
          <dd>{DOMAIN_LABELS[person.domain]}</dd>
        </div>
        <div>
          <dt>生卒</dt>
          <dd>{formatLifeYears(person)}</dd>
        </div>
        <div>
          <dt>轨迹</dt>
          <dd>{formatYearSpan(person.trajectoryStartYear, person.trajectoryEndYear)}</dd>
        </div>
      </dl>
      <p className="history-person-card-chronology">
        {CHRONOLOGY_LABELS[person.chronologyStatus]}
      </p>
      <p className="history-person-card-reason">{person.selectionReason}</p>
      <section className="history-person-card-evidence" aria-label="地点证据">
        <h3>地点证据 · {evidence.length}</h3>
        {evidence.length > 0 ? (
          <ol>
            {evidence.map((item) => (
              <li key={item.evidenceSpanIndex}>
                <strong>{item.locationLabel}</strong>
                <span>{formatYearSpan(item.startYear, item.endYear)}</span>
                <span>
                  {derivationLabel(item.derivation)} · 不确定度
                  {" "}
                  {Math.round(item.uncertainty * 100)}%
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p>此人行迹暂无有据地点，唯余生命时间线。</p>
        )}
      </section>
      <div className="history-person-card-actions">
        <button type="button" className="history-person-focus" onClick={onFocus}>
          望其人
        </button>
        <div className="history-person-isolation" role="group" aria-label="人物隔离模式">
          <button
            type="button"
            aria-pressed={isolationMode === "dim"}
            onClick={() => onIsolationModeChange("dim")}
          >
            弱化他人
          </button>
          <button
            type="button"
            aria-pressed={isolationMode === "isolate"}
            onClick={() => onIsolationModeChange("isolate")}
          >
            仅显此人
          </button>
        </div>
        <button type="button" className="history-person-close" onClick={onClose}>
          合上
        </button>
      </div>
    </aside>
  );
}

function HistoryDirectory({
  data,
  selectedPersonIndex,
  onPersonSelect,
  onClose,
}: {
  data: RenderHistoryDataset;
  selectedPersonIndex: number | null;
  onPersonSelect: (personIndex: number) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    const orderedEras = [...data.eras].sort((a, b) => a.order - b.order);
    return orderedEras.map((era) => ({
      era,
      people: data.people
        .map((person, index) => ({ person, index }))
        .filter(({ person }) => person.eraId === era.id),
    })).filter((group) => group.people.length > 0);
  }, [data]);
  return (
    <aside className="history-directory" aria-label="人物名录">
      <header className="history-directory-header">
        <h2>人物名录</h2>
        <p>
          {data.manifest.personCount} 位跨时代核心人物 · 策展启动数据，非完整全史
        </p>
        <button type="button" onClick={onClose} aria-label="合上名录">×</button>
      </header>
      <div className="history-directory-body">
        {groups.map(({ era, people }) => (
          <section key={era.id}>
            <h3>{era.label}</h3>
            <ul>
              {people.map(({ person, index }) => (
                <li key={person.id}>
                  <button
                    type="button"
                    aria-pressed={index === selectedPersonIndex}
                    onClick={() => onPersonSelect(index)}
                  >
                    <strong>{person.canonicalName}</strong>
                    <span>
                      {formatYearSpan(person.trajectoryStartYear, person.trajectoryEndYear)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

export interface HistoryExperienceProps {
  data: RenderHistoryDataset;
  currentYear: number | null;
  prologueOpen: boolean;
  onPrologueChange: (open: boolean) => void;
  hoveredPersonIndex: number | null;
  pointerPosition: { x: number; y: number } | null;
  selectedPersonIndex: number | null;
  isolationMode: PersonIsolationMode;
  onIsolationModeChange: (mode: PersonIsolationMode) => void;
  onEraSelect: (era: RenderEraRecord) => void;
  onPersonSelect: (personIndex: number | null, focus?: boolean) => void;
}

export function HistoryExperience({
  data,
  currentYear,
  prologueOpen,
  onPrologueChange,
  hoveredPersonIndex,
  pointerPosition,
  selectedPersonIndex,
  isolationMode,
  onIsolationModeChange,
  onEraSelect,
  onPersonSelect,
}: HistoryExperienceProps) {
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const hoveredPerson = hoveredPersonIndex === null ? null : data.people[hoveredPersonIndex];

  return (
    <div className="history-experience">
      <div className="history-grain" aria-hidden="true" />

      {!prologueOpen ? (
        <header className="history-colophon">
          <button
            type="button"
            className="history-colophon-title"
            onClick={() => onPrologueChange(true)}
            aria-label="重开序章"
          >
            <span className="history-colophon-name">落九川</span>
            <span className="history-seal history-seal-mini" aria-hidden="true">川</span>
          </button>
        </header>
      ) : null}

      <HistoryEraRail
        eras={data.eras}
        currentYear={currentYear}
        onEraSelect={onEraSelect}
      />

      <div className="history-top-actions">
        <button
          type="button"
          className="history-directory-toggle"
          aria-pressed={directoryOpen}
          onClick={() => setDirectoryOpen((open) => !open)}
        >
          名 录
        </button>
      </div>

      {directoryOpen ? (
        <HistoryDirectory
          data={data}
          selectedPersonIndex={selectedPersonIndex}
          onPersonSelect={(personIndex) => {
            onPersonSelect(personIndex, true);
            setDirectoryOpen(false);
          }}
          onClose={() => setDirectoryOpen(false)}
        />
      ) : null}

      {selectedPersonIndex !== null ? (
        <HistoryPersonCard
          data={data}
          personIndex={selectedPersonIndex}
          isolationMode={isolationMode}
          onIsolationModeChange={onIsolationModeChange}
          onFocus={() => onPersonSelect(selectedPersonIndex, true)}
          onClose={() => onPersonSelect(null)}
        />
      ) : null}

      {hoveredPerson && pointerPosition && selectedPersonIndex === null ? (
        <HistoryPersonTooltip person={hoveredPerson} position={pointerPosition} />
      ) : null}

      <footer className="history-hints" aria-hidden="true">
        <span>左键 环流</span>
        <span>右键 平移</span>
        <span>滚轮 远近</span>
        <span>双击 全景</span>
        <span>点取 识人</span>
      </footer>

      {prologueOpen ? (
        <HistoryPrologue data={data} onClose={() => onPrologueChange(false)} />
      ) : null}
    </div>
  );
}

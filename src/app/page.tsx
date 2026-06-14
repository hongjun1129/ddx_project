"use client";

import { useMemo, useState } from "react";
import {
  appKeyChecklist,
  dataIntegrityReport,
  ddxMaster,
  implementationRules,
  redFlagGates
} from "@/data/clinical-data";
import { runClinicalEngine, SAFETY_NOTE } from "@/lib/clinical-engine";
import type { ChecklistItem, ChecklistProposal, ChecklistStatus, ClinicalEngineOutput } from "@/types/clinical";

const initialFreeText = "";

const categories = ["전체", "문진", "활력", "진찰", "ECG", "혈액", "심장", "영상", "위장관", "근골격", "정신/기능"];
const tabs = ["응급 배제", "현재 의심", "Score", "요약"] as const;

function categoryMatches(item: ChecklistItem, category: string) {
  if (category === "전체") return true;
  const text = `${item.section} ${item.label} ${item.sourceExample ?? ""}`;
  if (category === "문진") return /문진|증상|위험인자|과거력/.test(text);
  if (category === "활력") return /활력|SpO2|혈압|저혈압|빈맥|발열|쇼크|호흡수/.test(text);
  if (category === "진찰") return /진찰|호흡음|압통|murmur|rub|JVD|Murphy/.test(text);
  if (category === "ECG") return /ECG|ST|심전도/.test(text);
  if (category === "혈액") return /혈액|troponin|cTn|D-dimer|BNP|CBC|CRP/.test(text);
  if (category === "심장") return /심장|관상|ACS|echo|HEART|GRACE/.test(text);
  if (category === "영상") return /영상|CXR|CT|CTA|CCTA|POCUS|US|MRI/.test(text);
  if (category === "위장관") return /위장|소화|GERD|담낭|식도|상복부/.test(text);
  if (category === "근골격") return /근골격|흉벽|rib|늑골|압통/.test(text);
  if (category === "정신/기능") return /정신|기능|불안|공황|hyperventilation|과호흡/.test(text);
  return false;
}

function statusText(status: ChecklistStatus) {
  if (status === "present") return "있음";
  if (status === "absent") return "없음";
  if (status === "not_applicable") return "해당없음";
  return "미확인";
}

function badgeClass(label: string) {
  if (label.includes("높음") || label.includes("active")) return "badge high";
  if (label.includes("부족")) return "badge info";
  return "badge low";
}

function checklistWithStatus(statuses: Record<string, ChecklistStatus>) {
  return appKeyChecklist.map((item) => ({
    ...item,
    status: statuses[item.id] ?? item.status
  }));
}

function ReviewModal({
  proposals,
  setProposals,
  onClose,
  onApply,
  engine
}: {
  proposals: ChecklistProposal[];
  setProposals: (proposals: ChecklistProposal[]) => void;
  onClose: () => void;
  onApply: (proposals: ChecklistProposal[], confidentOnly?: boolean) => void;
  engine: ClinicalEngineOutput;
}) {
  const update = (index: number, patch: Partial<ChecklistProposal>) => {
    setProposals(proposals.map((proposal, current) => current === index ? { ...proposal, ...patch } : proposal));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>AI 체크리스트 반영안 검토</h2>
          <p className="muted">즉시 반영하지 않고, 승인된 항목만 체크리스트 상태에 반영합니다.</p>
        </div>
        <div className="modal-body">
          <table className="clinical-table">
            <thead>
              <tr>
                <th>항목</th>
                <th className="status-col">반영 예정값</th>
                <th>근거 문구</th>
                <th className="rank-col">신뢰도</th>
                <th className="status-col">작업</th>
              </tr>
            </thead>
            <tbody>
              {proposals.length === 0 ? (
                <tr>
                  <td colSpan={5}>반영 가능한 기존 체크리스트 항목을 찾지 못했습니다.</td>
                </tr>
              ) : proposals.map((proposal, index) => (
                <tr key={proposal.itemId}>
                  <td>
                    <strong>{proposal.itemLabel}</strong>
                    <div className="mini-meta">{proposal.itemId}</div>
                  </td>
                  <td>
                    <select
                      value={proposal.proposedStatus}
                      onChange={(event) => update(index, { proposedStatus: event.target.value as ChecklistStatus, action: "modify" })}
                    >
                      <option value="present">있음</option>
                      <option value="absent">없음</option>
                      <option value="unknown">미확인</option>
                      <option value="not_applicable">해당없음</option>
                    </select>
                  </td>
                  <td>{proposal.evidenceText || "근거 문구 없음"}</td>
                  <td>{Math.round(proposal.confidence * 100)}%</td>
                  <td>
                    <div className="proposal-action">
                      <select
                        value={proposal.action}
                        onChange={(event) => update(index, { action: event.target.value as ChecklistProposal["action"] })}
                      >
                        <option value="apply">반영</option>
                        <option value="modify">수정</option>
                        <option value="exclude">제외</option>
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <div className="button-row">
            <button className="secondary-button" onClick={() => onApply(proposals)}>전체 반영</button>
            <button className="secondary-button" onClick={() => onApply(proposals, true)}>확실한 항목만 반영</button>
            <button className="secondary-button" onClick={() => onApply(proposals)}>수정 후 반영</button>
            <button className="secondary-button" onClick={onClose}>취소</button>
          </div>
          <div className="footer-impact">
            <strong>반영 후 영향 요약</strong>
            <ul>
              <li>{engine.summary.priorityDiagnosis}: {engine.activeDifferentials[0]?.likelihoodLabel ?? "정보 부족"} 유지</li>
              <li>HEART Pathway: troponin 미입력 또는 pending이면 계산 불가</li>
              <li>PE: Wells PE 일부 정보 부족 여부 확인 필요</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [freeText, setFreeText] = useState(initialFreeText);
  const [activeCategory, setActiveCategory] = useState("전체");
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("현재 의심");
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [statuses, setStatuses] = useState<Record<string, ChecklistStatus>>(
    () => Object.fromEntries(appKeyChecklist.map((item) => [item.id, item.status]))
  );
  const [proposals, setProposals] = useState<ChecklistProposal[] | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  const checklist = useMemo(() => checklistWithStatus(statuses), [statuses]);
  const filteredChecklist = useMemo(
    () => checklist.filter((item) => categoryMatches(item, activeCategory)),
    [activeCategory, checklist]
  );
  const engine = useMemo(
    () => runClinicalEngine({ checklist, diagnoses: ddxMaster, redFlagGates, implementationRules }),
    [checklist]
  );
  const counts = useMemo(() => ({
    recorded: checklist.filter((item) => item.status !== "unknown").length,
    red: checklist.filter((item) => item.isRedFlagRelated && item.status === "present").length,
    absent: checklist.filter((item) => item.status === "absent").length,
    total: checklist.length
  }), [checklist]);

  const updateStatus = (id: string, status: ChecklistStatus) => {
    setStatuses((current) => ({ ...current, [id]: status }));
  };

  const createProposals = async () => {
    setLoadingAi(true);
    try {
      const response = await fetch("/api/extract-checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freeText, currentChecklist: checklist, mode: "mixed" })
      });
      const data = await response.json() as { proposals: ChecklistProposal[] };
      setProposals(data.proposals ?? []);
    } finally {
      setLoadingAi(false);
    }
  };

  const applyProposals = (items: ChecklistProposal[], confidentOnly = false) => {
    const next = { ...statuses };
    for (const proposal of items) {
      if (proposal.action === "exclude") continue;
      if (confidentOnly && proposal.confidence < 0.8) continue;
      next[proposal.itemId] = proposal.proposedStatus;
    }
    setStatuses(next);
    setProposals(null);
  };

  const copySummary = async () => {
    const text = [
      "흉통 평가 보조 AI 환자 요약",
      freeText,
      `우선 평가: ${engine.summary.priorityDiagnosis}`,
      `누락 정보: ${engine.missingInformation.join(", ") || "정보 부족"}`,
      SAFETY_NOTE
    ].join("\n");
    await navigator.clipboard?.writeText(text);
  };

  return (
    <main className="app-shell">
      <header className="vital-bar">
        <div className="brand-cell">흉통 평가 보조 AI</div>
        <div className="vital-cell"><span className="vital-label">67세 / 남성</span><span className="vital-value">내원 환자</span></div>
        <div className="vital-cell"><span className="vital-label">내원</span><span className="vital-value">2024-05-22 14:30</span></div>
        <div className="vital-cell"><span className="vital-label">흉통 시작</span><span className="vital-value">2시간 전</span></div>
        <div className="vital-cell"><span className="vital-label">BP</span><span className="vital-value vital-red">150/90</span></div>
        <div className="vital-cell"><span className="vital-label">HR</span><span className="vital-value vital-red">96</span></div>
        <div className="vital-cell"><span className="vital-label">RR</span><span className="vital-value vital-neutral">18</span></div>
        <div className="vital-cell"><span className="vital-label">SpO2</span><span className="vital-value vital-green">97%</span></div>
        <div className="vital-cell"><span className="vital-label">BT</span><span className="vital-value vital-green">36.8°C</span></div>
        <div className="vital-cell"><button className="copy-button" onClick={copySummary}>환자 요약 복사</button></div>
      </header>

      <div className="main-grid">
        <aside>
          <section className="panel section">
            <h1 className="section-title">1. 의사 자유입력 (문진/검사 결과)</h1>
            <textarea className="free-text" value={freeText} onChange={(event) => setFreeText(event.target.value)} />
            <button className="primary-button" onClick={createProposals} disabled={loadingAi}>
              {loadingAi ? "반영안 생성 중" : "AI로 체크리스트 반영안 생성"}
            </button>
          </section>

          <section className="panel section">
            <div className="summary-line">
              <h2 className="section-title">2. 체크리스트</h2>
              <div className="count-strip">
                <span>기록 <strong>{counts.recorded}</strong></span>
                <span>Red <strong className="red">{counts.red}</strong></span>
                <span>없음 <strong>{counts.absent}</strong></span>
                <span>전체 <strong>{counts.total}</strong></span>
              </div>
            </div>
            <div className="chips">
              {categories.map((category) => (
                <button
                  className={`chip ${activeCategory === category ? "active" : ""}`}
                  key={category}
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="checklist-wrap">
              <table className="clinical-table">
                <thead>
                  <tr>
                    <th className="select-col">선택</th>
                    <th>항목</th>
                    <th className="status-col">평가</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChecklist.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          className="check-box"
                          type="checkbox"
                          checked={Boolean(selectedRows[item.id])}
                          onChange={(event) => setSelectedRows((current) => ({ ...current, [item.id]: event.target.checked }))}
                        />
                      </td>
                      <td>
                        <div className={`item-label ${item.isRedFlagRelated ? "red-item" : ""}`}>{item.label}</div>
                        <div className="mini-meta">{item.section} · {item.relatedDiagnosisNames.slice(0, 2).join("; ")}</div>
                      </td>
                      <td>
                        <div className="segmented" aria-label={`${item.label} 평가`}>
                          <button className={item.status === "absent" ? "active absent" : ""} onClick={() => updateStatus(item.id, "absent")}>없음</button>
                          <button className={item.status === "present" ? "active present" : ""} onClick={() => updateStatus(item.id, "present")}>있음</button>
                          <button className={item.status === "unknown" ? "active unknown" : ""} onClick={() => updateStatus(item.id, "unknown")}>미확인</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </aside>

        <section className="panel">
          <div className="tabs">
            {tabs.map((tab) => (
              <button key={tab} className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
                {tab}
              </button>
            ))}
          </div>
          <div className="center-content">
            {activeTab === "현재 의심" && (
              <>
                <div className="center-header">
                  <div>
                    <h2>현재 의심 진단 (우선순위)</h2>
                    <p className="muted">상대적 가능성을 기반으로 정렬된 목록입니다.</p>
                  </div>
                  <button className="secondary-button">정렬 기준</button>
                </div>
                <table className="clinical-table">
                  <thead>
                    <tr>
                      <th className="rank-col">순위</th>
                      <th>진단명</th>
                      <th>가능성이 높아진 근거</th>
                      <th className="status-col">가능성 평가</th>
                      <th className="rank-col">상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {engine.activeDifferentials.slice(0, 8).map((diagnosis, index) => (
                      <tr key={diagnosis.diagnosisId}>
                        <td>{index + 1}</td>
                        <td>
                          <div className="item-label">{diagnosis.nameKo}</div>
                          <div className="mini-meta">{diagnosis.english}</div>
                        </td>
                        <td>{diagnosis.evidence.join(", ")}</td>
                        <td><span className={badgeClass(diagnosis.likelihoodLabel)}>{diagnosis.likelihoodLabel}</span></td>
                        <td><button className="detail-button" aria-label="상세 열기">›</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="summary-box">
                  <h3>현재 의심 요약</h3>
                  <ul>
                    <li>최우선 평가 진단은 {engine.summary.priorityDiagnosis}입니다.</li>
                    <li>red flag 질환은 clinically ruled out 전까지 숨기지 않습니다.</li>
                    <li>{SAFETY_NOTE}</li>
                  </ul>
                </div>
              </>
            )}

            {activeTab === "응급 배제" && (
              <>
                <div className="center-header">
                  <div>
                    <h2>응급 배제 / Must-not-miss</h2>
                    <p className="muted">clinically ruled out 전까지 표시됩니다.</p>
                  </div>
                </div>
                <table className="clinical-table">
                  <thead>
                    <tr>
                      <th>진단명</th>
                      <th className="status-col">상태</th>
                      <th>아직 필요한 정보</th>
                      <th>가능성이 높아진 근거</th>
                    </tr>
                  </thead>
                  <tbody>
                    {engine.redFlags.slice(0, 10).map((flag) => (
                      <tr key={flag.diagnosisId}>
                        <td><strong>{flag.nameKo}</strong><div className="mini-meta">{flag.mustNotMissGate}</div></td>
                        <td><span className={badgeClass(flag.likelihoodLabel)}>{flag.likelihoodLabel}</span></td>
                        <td>{flag.neededInformation.join(", ") || "정보 부족 / 확인 필요"}</td>
                        <td>{flag.evidence.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {activeTab === "Score" && (
              <div className="score-grid">
                <div className="center-header">
                  <div>
                    <h2>Score</h2>
                    <p className="muted">06_Score_Items 기반. 원본에 없는 계산식이나 threshold는 만들지 않습니다.</p>
                  </div>
                </div>
                {engine.scoreAssessments.map((score) => (
                  <div className="score-row" key={score.name}>
                    <h3>{score.name}</h3>
                    <p><span className={badgeClass(score.status)}>{score.status}</span></p>
                    <p><strong>누락 정보:</strong> {score.missingInformation.join(", ")}</p>
                    <p className="muted">{score.note}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "요약" && (
              <div className="summary-box">
                <h3>요약</h3>
                <ul>
                  <li>현재 가장 우선 평가할 질환: {engine.summary.priorityDiagnosis}</li>
                  <li>아직 배제되지 않은 red flag: {engine.summary.unresolvedRedFlags.join(", ") || "정보 부족"}</li>
                  <li>가능성이 높아진 근거: {engine.summary.evidence.join(", ")}</li>
                  <li>누락 정보: {engine.missingInformation.join(", ") || "정보 부족"}</li>
                  <li>권장 다음 검사: {engine.recommendedActions.slice(0, 4).join(" / ") || "입력 필요"}</li>
                  <li>{engine.summary.safetyNote}</li>
                </ul>
              </div>
            )}
            <p className="safety-note">※ 가능성 평가는 환자 정보 변경 시 달라질 수 있으며, 모든 최종 판단과 치료 결정은 의료진 책임입니다.</p>
          </div>
        </section>

        <aside className="side-column">
          <section className="panel side-panel">
            <h2>7. 다음 액션</h2>
            <ul>
              {engine.recommendedActions.slice(0, 5).map((action) => <li key={action}>{action}</li>)}
            </ul>
          </section>
          <section className="panel side-panel">
            <h2>8. 누락 정보</h2>
            <ul>
              {(engine.missingInformation.length ? engine.missingInformation : ["DVT/PE 위험요인", "통증 지속 여부 및 악화/완화 요인", "최근 수술, 장거리 이동, 투약 여부"]).slice(0, 6).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
          <section className="panel side-panel">
            <h2>9. 권장 다음 검사</h2>
            <ul>
              <li>serial hs-troponin 0h, 1~2h 확인 필요</li>
              <li>12-lead ECG 반복 확인 필요</li>
              <li>CXR 확인 필요</li>
              <li>D-dimer는 PE 가능성 중간 이상 시 조건부 고려</li>
              <li>POCUS 심장/폐/하지정맥 고려</li>
              <li>필요 시 CT Aorta 고려</li>
            </ul>
          </section>
          <section className="panel side-panel">
            <h2>데이터 무결성</h2>
            <ul>
              <li>진단노드 {dataIntegrityReport.generatedCounts.ddxMaster}</li>
              <li>App key {dataIntegrityReport.generatedCounts.appKeyChecklist}</li>
              <li>Comprehensive {dataIntegrityReport.generatedCounts.comprehensiveChecklist}</li>
            </ul>
          </section>
        </aside>
      </div>

      {proposals && (
        <ReviewModal
          proposals={proposals}
          setProposals={setProposals}
          onClose={() => setProposals(null)}
          onApply={applyProposals}
          engine={engine}
        />
      )}
    </main>
  );
}

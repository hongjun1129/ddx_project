import appKeyChecklistJson from "./generated/appKeyChecklist.json";
import comprehensiveChecklistJson from "./generated/comprehensiveChecklist.json";
import dataIntegrityReportJson from "./generated/dataIntegrityReport.json";
import ddxMasterJson from "./generated/ddxMaster.json";
import dispositionJson from "./generated/disposition.json";
import implementationRulesJson from "./generated/implementationRules.json";
import redFlagGatesJson from "./generated/redFlagGates.json";
import scoreItemsJson from "./generated/scoreItems.json";

import type {
  ChecklistItem,
  DiagnosisNode,
  DispositionPath,
  ImplementationRule,
  RedFlagGate,
  ScoreItem
} from "@/types/clinical";

export const ddxMaster = ddxMasterJson as DiagnosisNode[];
export const appKeyChecklist = appKeyChecklistJson as ChecklistItem[];
export const comprehensiveChecklist = comprehensiveChecklistJson as ChecklistItem[];
export const redFlagGates = redFlagGatesJson as RedFlagGate[];
export const scoreItems = scoreItemsJson as ScoreItem[];
export const implementationRules = implementationRulesJson as ImplementationRule[];
export const disposition = dispositionJson as DispositionPath[];
export const dataIntegrityReport = dataIntegrityReportJson;

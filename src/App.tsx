import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  FileSpreadsheet,
  Download,
  ScanLine,
  CheckCircle,
  ChevronRight,
  Settings,
  Loader2,
  ArrowLeft,
  Trash2,
  Edit3,
  FileText,
  UploadCloud,
  Key,
  XCircle,
  AlertCircle,
  Archive,
  Building2,
  MapPin,
  Microscope,
  Activity,
  Scan,
  Briefcase,
  Bone,
  Smile,
  Zap,
  Files,
  Radio,
  MoreVertical,
  LogOut,
  User,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Firebase imports
import { auth, db, googleProvider } from "./firebase";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User as FirebaseUser,
} from "firebase/auth";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

// --- CONFIGURATION ---
const DB_NAME = "RayScanDB";
const DB_VERSION = 1;
const STORE_NAME = "templates";

// --- INDEXED DB HELPERS ---
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "type" });
      }
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event) => reject(event);
  });
};

const saveTemplateToDB = async (
  type: string,
  name: string,
  buffer: ArrayBuffer
) => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.put({ type, name, buffer });
};

const getTemplatesFromDB = async () => {
  const db = await openDB();
  return new Promise<{ type: string; name: string; buffer: ArrayBuffer }[]>(
    (resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
    }
  );
};

const deleteTemplateFromDB = async (type: string) => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.delete(type);
};

// --- TYPES ---
type InspectionType =
  | "dental"
  | "general"
  | "analytical"
  | "fluoroscope"
  | "ct"
  | "cabinet"
  | "bone_density"
  | "industrial"
  | "cbct"
  | "panoramic"
  | "combination_rf"
  | "accelerator";

type Machine = {
  id: string;
  fullDetails: string;
  make: string;
  model: string;
  serial: string;
  type: string;
  inspectionType: InspectionType;
  location: string;
  registrantName: string;
  entityId: string;
  data: { [key: string]: string };
  isComplete: boolean;
};

// --- HELPER FUNCTIONS ---
const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: {
      data: (await base64EncodedDataPromise) as string,
      mimeType: file.type,
    },
  };
};

const parseExcel = (file: File, callback: (data: any[]) => void) => {
  const reader = new FileReader();
  reader.onload = (evt) => {
    const arrayBuffer = evt.target?.result;
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const wsname = wb.SheetNames[0];
    const ws = wb.Sheets[wsname];
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
      if (
        rawData[i] &&
        rawData[i].some(
          (cell: any) => cell && cell.toString().includes("Inspection Number")
        )
      ) {
        headerRowIndex = i;
        break;
      }
    }
    if (headerRowIndex === -1) {
      alert("Could not find header row 'Inspection Number'.");
      return;
    }
    const data = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex });
    callback(data);
  };
  reader.readAsArrayBuffer(file);
};

const createWordDoc = (
  templateBuffer: ArrayBuffer,
  data: any,
  filename: string
) => {
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    doc.render(data);
    const out = doc.getZip().generate({
      type: "blob",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    saveAs(out, filename);
  } catch (error) {
    console.error(error);
    alert("Error generating document. Check your template tags!");
  }
};

// --- STEP CONFIGURATIONS ---
const DENTAL_STEPS = [
  {
    id: "scan1",
    label: "1. Technique Scan",
    desc: "Order: kVp, Dose, Time, HVL",
    indices: ["kvp", "mR", "time", "hvl"],
    fields: ["kvp", "mR1", "time1", "hvl"],
    scanType: "screen",
  },
  {
    id: "scan2",
    label: "2. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR2", "time2"],
    indices: ["mR", "time"],
    scanType: "screen",
  },
  {
    id: "scan3",
    label: "3. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR3", "time3"],
    indices: ["mR", "time"],
    scanType: "screen",
  },
  {
    id: "scan4",
    label: "4. Reproducibility",
    desc: "Order: Dose (2nd), Time (3rd)",
    fields: ["mR4", "time4"],
    indices: ["mR", "time"],
    scanType: "screen",
  },
  {
    id: "scan5",
    label: "5. Scatter (6ft)",
    desc: "Order: Dose (2nd)",
    fields: ["6 foot"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "scan6",
    label: "6. Scatter (Operator)",
    desc: "Order: Dose (2nd)",
    fields: ["operator location"],
    indices: ["mR"],
    scanType: "screen",
  },
];

const GENERAL_STEPS = [
  {
    id: "g1",
    label: "1. Linearity (Low)",
    desc: "Exp 1",
    settingsGroup: "g1",
    showSettings: true,
    defaultPresets: { kvp: "70", mas: "10", time: "" },
    indices: ["kvp", "mR", "time", "fields"],
    fields: ["g1_kvp", "g1_mr", "g1_time"],
    scanType: "screen",
  },
  {
    id: "g2a",
    label: "2. Reproducibility (1/4)",
    desc: "Exp 2",
    settingsGroup: "g2",
    showSettings: true,
    defaultPresets: { kvp: "70", mas: "16", time: "" },
    indices: ["kvp", "mR", "time"],
    fields: ["g2a_kvp", "g2a_mr", "g2a_time"],
    scanType: "screen",
  },
  {
    id: "g2b",
    label: "2. Reproducibility (2/4)",
    desc: "Exp 3",
    settingsGroup: "g2",
    showSettings: false,
    indices: ["kvp", "mR", "time"],
    fields: ["g2b_kvp", "g2b_mr", "g2b_time"],
    scanType: "screen",
  },
  {
    id: "g2c",
    label: "2. Reproducibility (3/4)",
    desc: "Exp 4",
    settingsGroup: "g2",
    showSettings: false,
    indices: ["kvp", "mR", "time"],
    fields: ["g2c_kvp", "g2c_mr", "g2c_time"],
    scanType: "screen",
  },
  {
    id: "g2d",
    label: "2. Reproducibility (4/4)",
    desc: "Exp 5",
    settingsGroup: "g2",
    showSettings: false,
    indices: ["kvp", "mR", "time"],
    fields: ["g2d_kvp", "g2d_mr", "g2d_time"],
    scanType: "screen",
  },
  {
    id: "g3",
    label: "3. Linearity (High)",
    desc: "Exp 6",
    settingsGroup: "g3",
    showSettings: true,
    defaultPresets: { kvp: "70", mas: "20", time: "" },
    indices: ["kvp", "mR", "time"],
    fields: ["g3_kvp", "g3_mr", "g3_time"],
    scanType: "screen",
  },
  {
    id: "g4",
    label: "4. HVL Check",
    desc: "Exp 7",
    settingsGroup: "g4",
    showSettings: true,
    defaultPresets: { kvp: "90", mas: "40", time: null },
    indices: ["kvp", "hvl"],
    fields: ["g4_kvp", "g4_hvl"],
    scanType: "screen",
  },
  {
    id: "g5",
    label: "5. Scatter (6ft)",
    desc: "Exp 8",
    settingsGroup: "g4",
    showSettings: false,
    indices: ["mR"],
    fields: ["g5_scatter"],
    scanType: "screen",
  },
  {
    id: "g6",
    label: "6. Scatter (Operator)",
    desc: "Exp 9",
    settingsGroup: "g4",
    showSettings: false,
    indices: ["mR"],
    fields: ["g6_scatter"],
    scanType: "screen",
  },
];

const ANALYTICAL_STEPS = [
  {
    id: "a1",
    label: "1. Scatter (6ft)",
    desc: "Order: Dose",
    fields: ["scatter_6ft"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "a2",
    label: "2. Scatter (Operator)",
    desc: "Order: Dose",
    fields: ["scatter_operator"],
    indices: ["mR"],
    scanType: "screen",
  },
];

const BONE_DENSITY_STEPS = [
  {
    id: "bd1",
    label: "1. Scatter (6ft)",
    desc: "Order: Dose (Default <1)",
    fields: ["scatter_6ft"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "bd2",
    label: "2. Scatter (Operator)",
    desc: "Order: Dose (Default <1)",
    fields: ["scatter_operator"],
    indices: ["mR"],
    scanType: "screen",
  },
];

const INDUSTRIAL_STEPS = [
  {
    id: "i1",
    label: "1. Scatter (6ft)",
    desc: "Order: Dose (Default <1)",
    fields: ["scatter_6ft"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "i2",
    label: "2. Scatter (Operator)",
    desc: "Order: Dose (Default <1)",
    fields: ["scatter_operator"],
    indices: ["mR"],
    scanType: "screen",
  },
];

const CBCT_STEPS = [
  {
    id: "cbct1",
    label: "1. Scatter (6ft)",
    desc: "Order: Dose",
    fields: ["6 foot"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "cbct2",
    label: "2. Scatter (Operator)",
    desc: "Order: Dose (Default <1)",
    fields: ["operator location"],
    indices: ["mR"],
    scanType: "screen",
  },
];

const PANORAMIC_STEPS = [
  {
    id: "pano1",
    label: "1. Scatter (6ft)",
    desc: "Order: Dose",
    fields: ["6 foot"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "pano2",
    label: "2. Scatter (Operator)",
    desc: "Order: Dose (Default <1)",
    fields: ["operator location"],
    indices: ["mR"],
    scanType: "screen",
  },
];

const FLUORO_STEPS = [
  {
    id: "f1",
    label: "1. Max Exposure & HVL (Standard)",
    desc: "RaySafe: Measure kVp, Rate & HVL.",
    showSettings: true,
    settingsGroup: "f1",
    defaultPresets: { mas: "Manual mA", kvp: "120", time: null },
    fields: ["kvp", "r/min", "hvl"],
    indices: ["kvp", "mR", "hvl"],
    scanType: "screen",
  },
  {
    id: "f3",
    label: "Physicist Report Data",
    desc: "Scan the previous report (multiple pages allowed).",
    isManualEntry: false,
    scanType: "document",
    fields: ["pkvp", "pma", "pr/min", "phvl", "phvl_kvp", "pname", "pdate"],
    indices: ["pkvp", "pma", "pr/min", "phvl", "phvl_kvp", "pname", "pdate"],
  },
];

const CT_STEPS = [
  {
    id: "ct1",
    label: "1. Technique Data",
    desc: "Manual Entry (Time, kVp, mA/mAs)",
    isManualEntry: true,
    fields: ["time", "kvp", "ma", "mas"],
    indices: [] as string[],
    scanType: "screen",
  },
  {
    id: "ct2",
    label: "2. Scatter (Operator)",
    desc: "Scan Dose (Usually <1)",
    fields: ["operator_scatter"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "ct3",
    label: "3. Physicist Info",
    desc: "Scan report for Name & Date (no data needed).",
    isManualEntry: false,
    scanType: "document",
    fields: ["pname", "pdate"],
    indices: ["pname", "pdate"],
  },
];

const CABINET_STEPS = [
  {
    id: "cab1",
    label: "1. Entrance Scatter",
    desc: "Scan Dose (Default <1)",
    fields: ["entrance"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "cab2",
    label: "2. Exit Scatter",
    desc: "Scan Dose (Default <1)",
    fields: ["exit"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "cab3",
    label: "3. Operator Scatter",
    desc: "Scan Dose (Default <1)",
    fields: ["operator_scatter"],
    indices: ["mR"],
    scanType: "screen",
  },
];

// --- HLC STEPS (Dynamic Additions) ---
const FLUORO_BOOST_MEASURE_STEP = {
  id: "f1_boost",
  label: "1b. Max Exposure (Boost)",
  desc: "Set Boost mA. Measure kVp & Rate.",
  showSettings: true,
  settingsGroup: "f1_boost",
  defaultPresets: { mas: "Boost mA", kvp: "120", time: null },
  fields: ["kvp_boost", "r/min_boost"],
  indices: ["kvp", "mR"],
  scanType: "screen",
};

const FLUORO_BOOST_PHYSICIST_STEP = {
  id: "f3_boost",
  label: "3b. Physicist Data (Boost)",
  desc: "Manual Entry (Boost Data)",
  isManualEntry: true,
  fields: ["pkvp_boost", "pma_boost", "pr/min_boost"],
  indices: [] as string[],
  scanType: "screen",
};

const ACCELERATOR_STEPS = [
  {
    id: "acc1",
    label: "1. Door Scatter",
    desc: "Order: Dose",
    fields: ["door_scatter"],
    indices: ["mR"],
    scanType: "screen",
  },
  {
    id: "acc2",
    label: "2. Console Scatter",
    desc: "Order: Dose",
    fields: ["console_scatter"],
    indices: ["mR"],
    scanType: "screen",
  },
];

// --- FIELD LABEL MAPPING ---
const getFieldLabel = (field: string): string => {
  const labels: Record<string, string> = {
    // Dental
    kvp: "kVp",
    mR1: "Dose",
    time1: "Time",
    hvl: "HVL",
    mR2: "Dose",
    time2: "Time",
    mR3: "Dose",
    time3: "Time",
    mR4: "Dose",
    time4: "Time",
    "6 foot": "6ft Scatter",
    "operator location": "Operator",
    // General
    g1_kvp: "kVp",
    g1_mr: "Dose",
    g1_time: "Time",
    g2a_kvp: "kVp",
    g2a_mr: "Dose",
    g2a_time: "Time",
    g2b_kvp: "kVp",
    g2b_mr: "Dose",
    g2b_time: "Time",
    g2c_kvp: "kVp",
    g2c_mr: "Dose",
    g2c_time: "Time",
    g2d_kvp: "kVp",
    g2d_mr: "Dose",
    g2d_time: "Time",
    g3_kvp: "kVp",
    g3_mr: "Dose",
    g3_time: "Time",
    g4_kvp: "kVp",
    g4_hvl: "HVL",
    g5_scatter: "6ft Scatter",
    g6_scatter: "Operator",
    // Scatter
    scatter_6ft: "6ft Scatter",
    scatter_operator: "Operator",
    // Fluoro
    "r/min": "R/min",
    pkvp: "Physicist kVp",
    pma: "Physicist mA",
    "pr/min": "Physicist R/min",
    phvl: "Physicist HVL",
    phvl_kvp: "HVL kVp",
    pname: "Physicist Name",
    pdate: "Date",
    time: "Time",
    ma: "mA",
    mas: "mAs",
    operator_scatter: "Operator",
    entrance: "Entrance",
    exit: "Exit",
    kvp_boost: "kVp (Boost)",
    "r/min_boost": "R/min (Boost)",
    pkvp_boost: "Physicist kVp (Boost)",
    pma_boost: "Physicist mA (Boost)",
    "pr/min_boost": "Physicist R/min (Boost)",
    // Accelerator
    door_scatter: "Door Scatter",
    console_scatter: "Console Scatter",
  };
  return labels[field] || field;
};

// --- HISTORY ENTRY CARD COMPONENT ---
type HistoryEntry = {
  id: string;
  facilityName: string;
  entityId: string;
  completedAt: string;
  machines: Machine[];
};

const HistoryEntryCard: React.FC<{
  entry: HistoryEntry;
  onDownload: (entry: HistoryEntry) => void;
}> = ({ entry, onDownload }) => {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloading(true);
    try {
      await onDownload(entry);
    } finally {
      setDownloading(false);
    }
  };
  const completedDate = new Date(entry.completedAt);
  const formattedDate = completedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = completedDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
            <Building2 className="text-blue-600" size={18} />
          </div>
          <div className="text-left">
            <p className="font-bold text-slate-800">{entry.facilityName}</p>
            <p className="text-xs text-slate-500">
              {formattedDate} at {formattedTime} • {entry.machines.length}{" "}
              machine{entry.machines.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="text-slate-400" size={20} />
        ) : (
          <ChevronDown className="text-slate-400" size={20} />
        )}
      </button>
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 p-3 space-y-2">
          {entry.machines.map((machine, idx) => (
            <div
              key={idx}
              className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <div
                  className={`h-6 w-6 rounded-full flex items-center justify-center ${
                    machine.isComplete ? "bg-emerald-100" : "bg-slate-100"
                  }`}
                >
                  {machine.isComplete ? (
                    <CheckCircle className="text-emerald-600" size={14} />
                  ) : (
                    <XCircle className="text-slate-400" size={14} />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    {machine.location}
                  </p>
                  <p className="text-xs text-slate-400">
                    {machine.type} • {machine.make} - {machine.model} -{" "}
                    {machine.serial}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {entry.machines.some((m) => m.isComplete) && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="mt-2 py-1.5 px-4 bg-blue-600 text-white rounded-full font-medium text-xs hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 mx-auto"
            >
              {downloading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Generating...
                </>
              ) : (
                <>
                  <Download size={16} />
                  Download Reports (.zip)
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default function App(): JSX.Element | null {
  // --- AUTH STATE ---
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  const [view, setViewState] = useState<
    "facility-list" | "machine-list" | "mobile-form" | "settings"
  >("facility-list");

  // Track scroll positions for each view independently
  const scrollPositions = useRef<{ [key: string]: number }>({
    "facility-list": 0,
    "machine-list": 0,
    "mobile-form": 0,
    settings: 0,
  });

  // Custom setView that saves/restores scroll positions
  const setView = (
    newView: "facility-list" | "machine-list" | "mobile-form" | "settings",
    resetScroll = false
  ) => {
    // Save current scroll position before leaving
    scrollPositions.current[view] = window.scrollY;

    // Reset scroll for the new view if requested (e.g., when opening a new machine)
    if (resetScroll) {
      scrollPositions.current[newView] = 0;
    }

    // Change view
    setViewState(newView);

    // Restore scroll position after view change (use setTimeout to ensure DOM is updated)
    setTimeout(() => {
      window.scrollTo(0, scrollPositions.current[newView] || 0);
    }, 0);
  };

  const [apiKey, setApiKey] = useState<string>("");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isTemplateDragging, setIsTemplateDragging] = useState(false);

  const [activeFacilityId, setActiveFacilityId] = useState<string | null>(null);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);

  const [showNoDataModal, setShowNoDataModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "apiKey" | "templates" | "history"
  >("apiKey");
  const [inspectionHistory, setInspectionHistory] = useState<
    Array<{
      id: string;
      facilityName: string;
      entityId: string;
      completedAt: string;
      machines: Machine[];
    }>
  >([]);

  // Machine list menu state
  const [showMachineMenu, setShowMachineMenu] = useState(false);
  const [showMachineSelector, setShowMachineSelector] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [selectedMachineForTypeChange, setSelectedMachineForTypeChange] =
    useState<string | null>(null);
  const [typeChangeSelection, setTypeChangeSelection] = useState({
    inspectionType: "dental" as InspectionType,
    typeLabel: "Intraoral",
  });

  // XX Machine creation state
  const [showXXMachineModal, setShowXXMachineModal] = useState(false);
  const [xxMachineData, setXXMachineData] = useState({
    make: "",
    model: "",
    serial: "",
    inspectionType: "dental" as InspectionType,
    typeLabel: "Intraoral",
  });

  // Per-machine menu state
  const [machineMenuId, setMachineMenuId] = useState<string | null>(null);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesText, setNotesText] = useState("");

  const [templates, setTemplates] = useState<
    Record<string, ArrayBuffer | null>
  >({
    dental: null,
    general: null,
    analytical: null,
    fluoroscope: null,
    ct: null,
    cabinet: null,
    bone_density: null,
    industrial: null,
    accelerator: null,
  });
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({
    dental: "No Template",
    general: "No Template",
    analytical: "No Template",
    fluoroscope: "No Template",
    ct: "No Template",
    cabinet: "No Template",
    bone_density: "No Template",
    industrial: "No Template",
    accelerator: "No Template",
  });
  const [isScanning, setIsScanning] = useState<string | null>(null);
  const [lastScannedText, setLastScannedText] = useState<string>("");
  const [isParsingDetails, setIsParsingDetails] = useState(false);

  // --- AUTH LISTENER ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- INACTIVITY AUTO-LOGOUT (48 hours) ---
  const INACTIVITY_TIMEOUT = 48 * 60 * 60 * 1000; // 48 hours in milliseconds
  const ACTIVITY_KEY = "lastActivityTimestamp";

  // Update last activity timestamp
  const updateLastActivity = () => {
    localStorage.setItem(ACTIVITY_KEY, Date.now().toString());
  };

  // Track user activity
  useEffect(() => {
    if (!currentUser) return;

    // Set initial activity timestamp on login
    if (!localStorage.getItem(ACTIVITY_KEY)) {
      updateLastActivity();
    }

    const handleActivity = () => updateLastActivity();

    // Listen for user interactions
    window.addEventListener("click", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("touchstart", handleActivity);
    window.addEventListener("scroll", handleActivity);

    return () => {
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      window.removeEventListener("scroll", handleActivity);
    };
  }, [currentUser]);

  // Check for inactivity timeout
  useEffect(() => {
    if (!currentUser) return;

    const checkInactivity = async () => {
      const lastActivity = localStorage.getItem(ACTIVITY_KEY);
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed >= INACTIVITY_TIMEOUT) {
          localStorage.removeItem(ACTIVITY_KEY);
          await signOut(auth);
        }
      }
    };

    // Check immediately on mount
    checkInactivity();

    // Check every 5 minutes
    const interval = setInterval(checkInactivity, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [currentUser]);

  // --- FIRESTORE SYNC: Load machines when user logs in ---
  useEffect(() => {
    if (!currentUser) {
      setMachines([]);
      return;
    }

    const machinesRef = collection(db, "users", currentUser.uid, "machines");

    const unsubscribe = onSnapshot(
      machinesRef,
      (snapshot) => {
        const loadedMachines: Machine[] = [];
        snapshot.forEach((doc) => {
          loadedMachines.push({ id: doc.id, ...doc.data() } as Machine);
        });
        // Sort by location for stable ordering
        loadedMachines.sort((a, b) => a.location.localeCompare(b.location));
        setMachines(loadedMachines);
      },
      (error) => {
        console.error("Firestore sync error:", error);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // --- FIRESTORE SYNC: Load inspection history ---
  useEffect(() => {
    if (!currentUser) {
      setInspectionHistory([]);
      return;
    }

    const historyRef = collection(db, "users", currentUser.uid, "history");

    const unsubscribe = onSnapshot(
      historyRef,
      (snapshot) => {
        const loadedHistory: typeof inspectionHistory = [];
        snapshot.forEach((doc) => {
          loadedHistory.push({ id: doc.id, ...doc.data() } as any);
        });
        // Sort by completedAt descending (most recent first)
        loadedHistory.sort(
          (a, b) =>
            new Date(b.completedAt).getTime() -
            new Date(a.completedAt).getTime()
        );
        // Keep only last 20
        setInspectionHistory(loadedHistory.slice(0, 20));
      },
      (error) => {
        console.error("History sync error:", error);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // --- FIRESTORE HELPER: Archive facility to history ---
  const archiveFacilityToHistory = async (
    entityId: string,
    facilityName: string
  ) => {
    if (!currentUser) return;

    const facilityMachines = machines.filter((m) => m.entityId === entityId);
    if (facilityMachines.length === 0) return;

    const historyEntry = {
      facilityName,
      entityId,
      completedAt: new Date().toISOString(),
      machines: facilityMachines.map((m) => ({
        ...m,
        // Remove any circular references or functions
      })),
    };

    const historyRef = doc(
      db,
      "users",
      currentUser.uid,
      "history",
      `${entityId}_${Date.now()}`
    );
    await setDoc(historyRef, historyEntry);
  };

  // --- AUTH FUNCTIONS ---
  const handleGoogleLogin = async () => {
    try {
      setAuthError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      setAuthError(error.message);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (error: any) {
      setAuthError(error.message);
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem(ACTIVITY_KEY);
    await signOut(auth);
    setView("facility-list");
  };

  // --- FIRESTORE HELPER: Save machine ---
  const saveMachineToFirestore = async (machine: Machine) => {
    if (!currentUser) return;
    const machineRef = doc(
      db,
      "users",
      currentUser.uid,
      "machines",
      machine.id
    );
    await setDoc(
      machineRef,
      {
        ...machine,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  // --- FIRESTORE HELPER: Delete machine ---
  const deleteMachineFromFirestore = async (machineId: string) => {
    if (!currentUser) return;
    const machineRef = doc(db, "users", currentUser.uid, "machines", machineId);
    await deleteDoc(machineRef);
  };

  useEffect(() => {
    if (!document.getElementById("tailwind-script")) {
      const script = document.createElement("script");
      script.src = "https://cdn.tailwindcss.com";
      script.id = "tailwind-script";
      document.head.appendChild(script);
    }

    const savedKey = localStorage.getItem("rayScanApiKey");
    if (savedKey) setApiKey(savedKey);

    const savedMachines = localStorage.getItem("rayScanMachines");
    if (savedMachines) {
      try {
        const parsed: any[] = JSON.parse(savedMachines);
        const migrated = parsed.map((m) => ({
          ...m,
          inspectionType: m.inspectionType || "dental",
          make: m.make || "",
          model: m.model || "",
          serial: m.serial || "",
          data: m.data || {},
        }));
        setMachines(migrated);
      } catch (e) {
        console.error("Failed to load machines", e);
      }
    }

    getTemplatesFromDB().then((storedTemplates) => {
      const loadedTemplates: any = { ...templates };
      const loadedNames: any = { ...templateNames };
      storedTemplates.forEach((t) => {
        loadedTemplates[t.type] = t.buffer;
        loadedNames[t.type] = t.name;
      });
      setTemplates(loadedTemplates);
      setTemplateNames(loadedNames);
    });
  }, []);

  // Machines are now synced via Firestore onSnapshot listener
  // Local storage backup for offline (optional)
  useEffect(() => {
    if (currentUser && machines.length > 0) {
      localStorage.setItem("rayScanMachines", JSON.stringify(machines));
    }
  }, [machines, currentUser]);

  const parseDetailsWithGemini = async (machine: Machine) => {
    if (!apiKey || (machine.make && machine.model && machine.serial)) return;
    setIsParsingDetails(true);
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `Parse X-ray string: "${machine.fullDetails}". Return JSON: { "make": "", "model": "", "serial": "" }.`;
      const result = await model.generateContent(prompt);
      const text = result.response
        .text()
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      const data = JSON.parse(text);
      setMachines((prev) =>
        prev.map((m) =>
          m.id === machine.id
            ? { ...m, make: data.make, model: data.model, serial: data.serial }
            : m
        )
      );
    } catch (error) {
      console.error(error);
    } finally {
      setIsParsingDetails(false);
    }
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setApiKey(val);
    localStorage.setItem("rayScanApiKey", val);
  };

  const processTemplateFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      const name = file.name.toLowerCase();
      let type: InspectionType | null = null;

      if (name.includes("dental")) type = "dental";
      else if (name.includes("gen") || name.includes("rad")) type = "general";
      else if (name.includes("bone")) type = "bone_density";
      else if (name.includes("industrial") || name.includes("ir"))
        type = "industrial";
      else if (
        name.includes("analytical") ||
        name.includes("diffraction") ||
        name.includes("fluorescence")
      )
        type = "analytical";
      else if (name.includes("fluoro") || name.includes("c-arm"))
        type = "fluoroscope";
      else if (
        name.includes("ct ") ||
        name.includes("computed") ||
        name.includes("tomography")
      )
        type = "ct";
      else if (
        name.includes("cabinet") ||
        name.includes("baggage") ||
        name.includes("security")
      )
        type = "cabinet";
      else if (name.includes("accelerator")) type = "accelerator";

      if (type) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          if (evt.target?.result) {
            const buffer = evt.target?.result as ArrayBuffer;
            setTemplates((prev) => ({ ...prev, [type!]: buffer }));
            setTemplateNames((prev) => ({ ...prev, [type!]: file.name }));
            saveTemplateToDB(type!, file.name, buffer);
          }
        };
        reader.readAsArrayBuffer(file);
      }
    });
  };

  const handleBulkTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) processTemplateFiles(files);
  };

  const handleTemplateDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsTemplateDragging(true);
  };

  const handleTemplateDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsTemplateDragging(false);
  };

  const handleTemplateDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsTemplateDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processTemplateFiles(files);
    }
  };

  const removeTemplate = (type: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTemplates((prev) => ({ ...prev, [type]: null }));
    setTemplateNames((prev) => ({ ...prev, [type]: "No Template" }));
    deleteTemplateFromDB(type);
  };

  // --- REUSABLE DATA PROCESSOR FOR EXCEL ---
  const processImportedData = (data: any[]) => {
    // Check for duplicate uploads - get entity IDs from the Excel data
    const incomingEntityIds = new Set(
      data
        .filter((row: any) => row["Entity ID"])
        .map((row: any) => row["Entity ID"]?.toString())
    );

    // Check if any of these entity IDs already exist in our machines
    const existingEntityIds = new Set(machines.map((m) => m.entityId));
    const duplicateIds = Array.from(incomingEntityIds).filter((id) =>
      existingEntityIds.has(id)
    );

    if (duplicateIds.length > 0) {
      alert(
        `This Excel sheet has already been uploaded. Facility with Entity ID ${duplicateIds[0]} already exists.`
      );
      return;
    }

    // Track R&F machines we've seen to alternate between general and fluoro
    const seenRFMachines = new Set<string>();

    const newMachines: Machine[] = data
      .filter((row: any) => row["Entity Name"] && row["Inspection Number"])
      .filter((row: any) => {
        const name = row["Entity Name"] || "";
        return name.includes("(") && name.includes(")");
      })
      .flatMap((row: any, index: number) => {
        const rawString = row["Entity Name"] || "";
        const credTypeRaw = row["License/Credential Type"] || "";
        const credType = credTypeRaw.toLowerCase();

        let fullDetails = "Unknown Machine";
        let facility = rawString;
        let make = "",
          model = "",
          serial = "";

        if (rawString.includes("(") && rawString.includes(")")) {
          const parts = rawString.split("(");
          facility = parts[0].trim();
          fullDetails = parts[1].replace(")", "");
          const detailsParts = fullDetails.split(/-\s+/);
          if (detailsParts.length >= 3) {
            make = detailsParts[0].trim();
            model = detailsParts[1].trim();
            serial = detailsParts[2].trim();
          } else if (detailsParts.length === 2) {
            make = detailsParts[0].trim();
            model = detailsParts[1].trim();
          } else {
            make = detailsParts[0].trim();
          }
        }

        // --- DETERMINE INSPECTION TYPE ---
        let inspectionType: InspectionType = "dental";

        // FIX: Check Analytical FIRST because "diffraction" contains "ct"
        // Check CBCT before CT and Panoramic (since "panoramic ct" contains both)
        if (credType.includes("industrial")) {
          inspectionType = "industrial";
        } else if (
          credType.includes("fluorescence") ||
          credType.includes("diffraction") ||
          credType.includes("electron microscope")
        ) {
          inspectionType = "analytical";
        } else if (credType.includes("bone")) {
          inspectionType = "bone_density";
        } else if (
          credType.includes("cbct") ||
          credType.includes("panoramic ct") ||
          credType.includes("panoramic cephalometric ct")
        ) {
          inspectionType = "cbct";
        } else if (
          credType.includes("panoramic") ||
          credType.includes("panoramic cephalometric")
        ) {
          inspectionType = "panoramic";
        } else if (credType.includes("ct") || credType.includes("tomography")) {
          inspectionType = "ct";
        } else if (
          credType.includes("cabinet") ||
          credType.includes("security")
        ) {
          inspectionType = "cabinet";
        } else if (credType.includes("intraoral")) {
          inspectionType = "dental";
        } else if (credType.includes("radiographic")) {
          inspectionType = "general";
        } else if (
          credType.includes("fluoroscope") ||
          credType.includes("c-arm") ||
          credType.includes("fluoro")
        ) {
          inspectionType = "fluoroscope";
        } else if (credType.includes("accelerator")) {
          inspectionType = "accelerator";
        } else {
          inspectionType = "dental";
        }

        // Handle Combination - R&F: create ONE machine per row (Excel already has 2 rows per R&F)
        const isCombinationRF =
          credType.includes("combination") &&
          (credType.includes("r&f") || credType.includes("r & f"));

        if (isCombinationRF) {
          const baseLocation = row["License/Credential #"] || facility;
          const entityId = row["Entity ID"]?.toString() || facility;

          // Create a unique key for this R&F machine based on make/model/serial and facility
          const rfKey = `${facility}|${make}|${model}|${serial}`;

          // Check if we've already seen this R&F machine (first row = general, second row = fluoro)
          const isFirstOccurrence = !seenRFMachines.has(rfKey);
          seenRFMachines.add(rfKey);

          // First occurrence = General/Radiographic, Second occurrence = Fluoro
          const machineIsFluoro = !isFirstOccurrence;
          const machineInspectionType: InspectionType = machineIsFluoro
            ? "fluoroscope"
            : "general";

          const machine: Machine = {
            id: `mach_${Date.now()}_${index}_${machineIsFluoro ? "F" : "R"}`,
            fullDetails: fullDetails,
            make,
            model,
            serial,
            type: machineIsFluoro ? "Fluoroscopic (R&F)" : "Radiographic (R&F)",
            inspectionType: machineInspectionType,
            location: `${baseLocation} (${machineIsFluoro ? "F" : "R"})`,
            registrantName: facility,
            entityId: entityId,
            data: { tube_no: machineIsFluoro ? "2" : "1", num_tubes: "2" },
            isComplete: false,
          };

          return [machine];
        }

        return [
          {
            id: `mach_${Date.now()}_${index}`,
            fullDetails: fullDetails,
            make,
            model,
            serial,
            type: credTypeRaw,
            inspectionType,
            location: row["License/Credential #"] || facility,
            registrantName: facility,
            entityId: row["Entity ID"]?.toString() || facility,
            data: {},
            isComplete: false,
          },
        ];
      });

    if (newMachines.length === 0) alert("No machines found.");
    else {
      setMachines((prev) => [...prev, ...newMachines]);
      // Save to Firestore
      newMachines.forEach((machine) => saveMachineToFirestore(machine));
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => {
        parseExcel(file, processImportedData);
      });
    }
  };

  // --- DRAG AND DROP HANDLERS ---
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => {
        parseExcel(file, processImportedData);
      });
    }
  };

  const performGeminiScan = async (
    files: FileList | File[],
    targetFields: string[],
    indices: string[],
    scanType: "screen" | "document" | string = "screen",
    stepId?: string
  ) => {
    if (!apiKey) {
      alert("Please go to Settings and enter your Google API Key first.");
      return;
    }

    setIsScanning(stepId || "unknown");
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const imageParts = await Promise.all(
        Array.from(files).map((file) => fileToGenerativePart(file))
      );

      let prompt = "";

      if (scanType === "document") {
        if (activeMachine?.inspectionType === "ct") {
          // --- CT DOCUMENT SCAN (NAME & DATE ONLY) ---
          prompt = `
            Analyze these report images. Return JSON.
            TASK: Find "Physicist Name" and "Date" of inspection.
            IGNORE all measurement data.
            Return keys: "pname", "pdate".
            Use null if missing.
          `;
        } else {
          // --- FLUORO DOCUMENT SCAN (FULL DATA + NAME/DATE) ---
          prompt = ` 
            TASK:
            1. Analyze these report images. Return JSON.
            2. Find "Physicist Name" and "Date" (split into two fields: "pname" and "pdate").
            3. Next, SCAN ALL PAGES for the physicist's measurements.
            4. Next, return keys: "pkvp", "pma", "pr/min", "pkvp_boost", "pma_boost", "pr/min_boost", "phvl", "phvl_kvp", "pname", "pdate".

            Requirements: 
            1. For kVp, mA, and Rate, only extract the data corresponding to the maximum output settings. Ignore data from lower settings (e.g. 70 kVp, 80 kVp).
            2. For HVL, only extract the HVL value corresponding to a kVp setting around 80. If figures at this setting cannot be found, default to HVL corresonding to the maximum output setting.
            2. DO NOT CONVERT UNITS. Return exactly as shown.
            3. For dose rate, ignore measurements that use Gy as the unit. We only care about R/min, mR/min, etc.
            4. Use null if missing.
          `;
        }
      } else if (activeMachine?.inspectionType === "fluoroscope") {
        // --- FLUORO SCREEN SCAN (RATE ONLY) ---
        prompt = `
          Analyze RaySafe screen. Return JSON.
          Find "kvp", "mR", "time", "hvl". Ignore pulses. Do not convert units. Do not return units. If you see "4.50 R/min", return "4.50"
          
          - For kVp, this figure is in the top left box on the screen. 
          - For mR, we want the DOSE RATE (R/min, mGy/min, uGy/s) not the total dose. This figure is in the middle middle box.
          - For time, this figure is in the top right box.
          - For HVL, this figure is in the middle left box.
        `;
      } else {
        // --- STANDARD SCREEN SCAN (DOSE ONLY) ---
        prompt = `
        Analyze RaySafe screen. Return JSON.
        Find "kvp", "mR", "time", "hvl". Ignore pulses. Do not convert units. Do not return units. If you see "4.50 R/min", return "4.50"
        
        - For kVp, this figure is in the top left box on the screen. 
        - For mR, we want the TOTAL DOSE (R, mGy, uGy) not the dose rate. This figure is in the top middle box.
        - For time, this figure is in the top right box.
        - For HVL, this figure is in the middle left box.
        `;
      }

      const result = await model.generateContent([prompt, ...imageParts]);
      const text = result.response
        .text()
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      const data = JSON.parse(text);
      setLastScannedText(JSON.stringify(data));

      const updates: Record<string, string> = {};
      targetFields.forEach((field, i) => {
        const key = indices[i];
        const val = data[key];
        if (val !== null && val !== undefined) updates[field] = val.toString();
      });
      if (Object.keys(updates).length > 0) {
        if (activeMachineId)
          setMachines((prev) =>
            prev.map((m) =>
              m.id === activeMachineId
                ? { ...m, data: { ...m.data, ...updates } }
                : m
            )
          );
      } else {
        alert("Gemini analyzed the image but couldn't find the specific data.");
      }
    } catch (error: any) {
      console.error("Gemini Error:", error);
      alert(`AI Scan Failed: ${error.message}`);
    } finally {
      setIsScanning(null);
    }
  };

  const handleScanClick = (
    e: React.ChangeEvent<HTMLInputElement>,
    fields: string[],
    indices: string[],
    scanType?: string,
    stepId?: string
  ) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      performGeminiScan(files, fields, indices, scanType || "screen", stepId);
    }
  };

  const updateField = (key: string, value: string) => {
    if (!activeMachineId) return;
    setMachines((prev) =>
      prev.map((m) =>
        m.id === activeMachineId
          ? { ...m, data: { ...m.data, [key]: value } }
          : m
      )
    );
  };

  const updateMachineDetails = (
    key: "make" | "model" | "serial",
    value: string
  ) => {
    if (!activeMachineId) return;
    setMachines((prev) =>
      prev.map((m) => (m.id === activeMachineId ? { ...m, [key]: value } : m))
    );
  };

  const updateMachineType = (newType: InspectionType) => {
    if (!activeMachineId) return;
    setMachines((prev) =>
      prev.map((m) =>
        m.id === activeMachineId ? { ...m, inspectionType: newType } : m
      )
    );
  };

  const updateMachineTypeById = (
    machineId: string,
    newType: InspectionType,
    typeLabel: string
  ) => {
    const machine = machines.find((m) => m.id === machineId);
    if (machine) {
      // Handle Combination R&F - create TWO machines (General + Fluoro)
      if (newType === "combination_rf") {
        const baseLocation = machine.location.replace(/ \([RF]\)$/, ""); // Remove any existing (R) or (F) suffix

        const generalMachine: Machine = {
          ...machine,
          id: `${machine.id}_R`,
          type: "Radiographic (R&F)",
          inspectionType: "general",
          location: `${baseLocation} (R)`,
          data: { ...machine.data, tube_no: "1", num_tubes: "2" },
        };

        const fluoroMachine: Machine = {
          ...machine,
          id: `${machine.id}_F`,
          type: "Fluoroscopic (R&F)",
          inspectionType: "fluoroscope",
          location: `${baseLocation} (F)`,
          data: { ...machine.data, tube_no: "2", num_tubes: "2" },
        };

        // Remove original machine, add both new machines
        setMachines((prev) => [
          ...prev.filter((m) => m.id !== machineId),
          generalMachine,
          fluoroMachine,
        ]);
        deleteMachineFromFirestore(machineId);
        saveMachineToFirestore(generalMachine);
        saveMachineToFirestore(fluoroMachine);
      } else {
        // Check if this machine is part of an R&F pair
        const isRFMachine = machine.location.match(/ \([RF]\)$/);

        if (isRFMachine) {
          // Get the base location without the (R) or (F) suffix
          const baseLocation = machine.location.replace(/ \([RF]\)$/, "");
          const currentSuffix = machine.location.endsWith("(R)")
            ? "(R)"
            : "(F)";
          const pairedSuffix = currentSuffix === "(R)" ? "(F)" : "(R)";
          const pairedLocation = `${baseLocation} ${pairedSuffix}`;

          // Find and delete the paired R&F machine
          const pairedMachine = machines.find(
            (m) => m.location === pairedLocation
          );
          if (pairedMachine) {
            deleteMachineFromFirestore(pairedMachine.id);
          }

          // Update current machine: remove suffix, change type, clear R&F data
          const { tube_no, num_tubes, ...restData } = machine.data;
          const updatedMachine = {
            ...machine,
            inspectionType: newType,
            type: typeLabel,
            location: baseLocation,
            data: restData,
          };

          // Remove paired machine and update current machine
          setMachines((prev) =>
            prev
              .filter((m) => m.location !== pairedLocation)
              .map((m) => (m.id === machineId ? updatedMachine : m))
          );
          saveMachineToFirestore(updatedMachine);
        } else {
          const updatedMachine = {
            ...machine,
            inspectionType: newType,
            type: typeLabel,
          };
          setMachines((prev) =>
            prev.map((m) => (m.id === machineId ? updatedMachine : m))
          );
          saveMachineToFirestore(updatedMachine);
        }
      }
    }
    // Reset the menu flow
    setShowTypeSelector(false);
    setSelectedMachineForTypeChange(null);
  };

  const createXXMachine = () => {
    if (!activeFacilityId) return;

    // Get facility machines to find existing XX machines and base credential
    const facilityMachines = machines.filter(
      (m) => m.entityId === activeFacilityId
    );
    if (facilityMachines.length === 0) return;

    // Count existing XX machines for this facility
    const existingXXCount = facilityMachines.filter((m) =>
      m.location.includes("-XX")
    ).length;
    const xxNumber = existingXXCount + 1;

    // Get base info from first machine in facility
    const baseMachine = facilityMachines[0];
    // Remove any existing XX suffix, then remove the last segment (machine number) and add XX number
    const cleanCredential = baseMachine.location.replace(/-XX\d+$/, "");
    const credentialParts = cleanCredential.split("-");
    credentialParts.pop(); // Remove the last segment (machine number like "01")
    const xxCredential = `${credentialParts.join("-")}-XX${xxNumber}`;

    // Check if this is a Combination R&F type - create TWO machines
    if (xxMachineData.inspectionType === "combination_rf") {
      const generalMachine: Machine = {
        id: `mach_xx_${Date.now()}_R`,
        fullDetails: `${xxMachineData.make} - ${xxMachineData.model} - ${xxMachineData.serial}`,
        make: xxMachineData.make,
        model: xxMachineData.model,
        serial: xxMachineData.serial,
        type: "Radiographic (R&F)",
        inspectionType: "general",
        location: `${xxCredential} (R)`,
        registrantName: baseMachine.registrantName,
        entityId: activeFacilityId,
        data: { tube_no: "1", num_tubes: "2" },
        isComplete: false,
      };

      const fluoroMachine: Machine = {
        id: `mach_xx_${Date.now()}_F`,
        fullDetails: `${xxMachineData.make} - ${xxMachineData.model} - ${xxMachineData.serial}`,
        make: xxMachineData.make,
        model: xxMachineData.model,
        serial: xxMachineData.serial,
        type: "Fluoroscopic (R&F)",
        inspectionType: "fluoroscope",
        location: `${xxCredential} (F)`,
        registrantName: baseMachine.registrantName,
        entityId: activeFacilityId,
        data: { tube_no: "2", num_tubes: "2" },
        isComplete: false,
      };

      setMachines((prev) => [...prev, generalMachine, fluoroMachine]);
      saveMachineToFirestore(generalMachine);
      saveMachineToFirestore(fluoroMachine);
    } else {
      const newMachine: Machine = {
        id: `mach_xx_${Date.now()}`,
        fullDetails: `${xxMachineData.make} - ${xxMachineData.model} - ${xxMachineData.serial}`,
        make: xxMachineData.make,
        model: xxMachineData.model,
        serial: xxMachineData.serial,
        type: xxMachineData.typeLabel,
        inspectionType: xxMachineData.inspectionType,
        location: xxCredential,
        registrantName: baseMachine.registrantName,
        entityId: activeFacilityId,
        data: {},
        isComplete: false,
      };

      setMachines((prev) => [...prev, newMachine]);
      saveMachineToFirestore(newMachine);
    }

    // Reset the modal
    setShowXXMachineModal(false);
    setXXMachineData({
      make: "",
      model: "",
      serial: "",
      inspectionType: "dental",
      typeLabel: "Intraoral",
    });
  };

  const deleteXXMachine = (machineId: string) => {
    const machine = machines.find((m) => m.id === machineId);
    if (!machine || !machine.location.includes("-XX")) return;
    setMachines((prev) => prev.filter((m) => m.id !== machineId));
    deleteMachineFromFirestore(machineId);
  };

  const deleteMachine = (machineId: string) => {
    setMachines((prev) => prev.filter((m) => m.id !== machineId));
    deleteMachineFromFirestore(machineId);
  };

  const handleNoData = (reason: "operational" | "facility") => {
    if (!activeMachineId) return;
    const message =
      reason === "operational"
        ? "MACHINE NOT OPERATIONAL"
        : "MACHINE NOT IN FACILITY";

    const updatedMachine = machines.find((m) => m.id === activeMachineId);
    if (updatedMachine) {
      const updated = {
        ...updatedMachine,
        isComplete: true,
        data: { ...updatedMachine.data, noDataReason: message },
      };
      setMachines((prev) =>
        prev.map((m) => (m.id === activeMachineId ? updated : m))
      );
      saveMachineToFirestore(updated);
    }

    setShowNoDataModal(false);
    setActiveMachineId(null);
    setView("machine-list");
  };

  const markAsComplete = () => {
    if (!activeMachineId) return;

    let updatedMachine: Machine | null = null;

    // Use functional update to ensure we read from the latest state
    // This is important because updateField may have queued state changes
    setMachines((prev) => {
      const machine = prev.find((m) => m.id === activeMachineId);
      if (!machine) return prev;

      const { noDataReason, ...cleanData } = machine.data;
      updatedMachine = { ...machine, isComplete: true, data: cleanData };

      return prev.map((m) => (m.id === activeMachineId ? updatedMachine! : m));
    });

    // Save to Firestore and handle multi-tube sync after state update
    if (updatedMachine) {
      saveMachineToFirestore(updatedMachine);
      handleMultiTubeSync(updatedMachine);
    }

    setActiveMachineId(null);
    setView("machine-list");
  };

  // --- MULTI-TUBE HANDLING ---
  // Pass updatedActiveMachine when the active machine has been modified (e.g., marked complete)
  const handleMultiTubeSync = (updatedActiveMachine?: Machine) => {
    if (!activeMachineId) return;

    // Use the updated machine if provided, otherwise get from state
    const machine =
      updatedActiveMachine || machines.find((m) => m.id === activeMachineId);
    if (!machine) return;

    // Only handle multi-tube for types that support it
    const multiTubeTypes: InspectionType[] = ["general", "fluoroscope", "ct"];
    if (!multiTubeTypes.includes(machine.inspectionType)) return;

    // Skip R&F machines - they already have 2 tubes by design (R and F)
    // and should not create additional machines based on num_tubes field
    if (machine.type.includes("(R&F)")) return;

    const numTubes = parseInt(machine.data["num_tubes"] || "1", 10);
    if (numTubes <= 1 || numTubes > 4) return;

    // Get the base location (strip any existing tube suffix like " (1)", " (2)", etc.)
    const baseLocation = machine.location.replace(/ \(\d\)$/, "");

    // Find all existing machines that share the same base characteristics
    const siblingMachines = machines.filter(
      (m) =>
        m.entityId === machine.entityId &&
        m.make === machine.make &&
        m.model === machine.model &&
        m.serial === machine.serial &&
        m.location.replace(/ \(\d\)$/, "") === baseLocation
    );

    const currentTubeCount = siblingMachines.length;

    // If we already have the right number of tubes, just ensure suffixes are correct
    if (currentTubeCount === numTubes) {
      // Update all siblings to have correct suffixes and num_tubes
      const updatedMachines = siblingMachines.map((m, idx) => {
        // If this is the active machine and we have an updated version, use it
        const baseMachine =
          m.id === activeMachineId && updatedActiveMachine
            ? updatedActiveMachine
            : m;
        return {
          ...baseMachine,
          location: `${baseLocation} (${idx + 1})`,
          data: {
            ...baseMachine.data,
            tube_no: String(idx + 1),
            num_tubes: String(numTubes),
          },
        };
      });

      setMachines((prev) =>
        prev.map((m) => {
          const updated = updatedMachines.find((u) => u.id === m.id);
          return updated || m;
        })
      );
      updatedMachines.forEach((m) => saveMachineToFirestore(m));
      return;
    }

    // Need to add more tubes
    if (currentTubeCount < numTubes) {
      // First, update the original machine with (1) suffix if it doesn't have one
      const updatedOriginal = {
        ...machine,
        location: `${baseLocation} (1)`,
        data: { ...machine.data, tube_no: "1", num_tubes: String(numTubes) },
      };

      // Update any existing siblings with correct tube numbers
      const updatedSiblings = siblingMachines
        .filter((m) => m.id !== machine.id)
        .map((m, idx) => ({
          ...m,
          location: `${baseLocation} (${idx + 2})`,
          data: {
            ...m.data,
            tube_no: String(idx + 2),
            num_tubes: String(numTubes),
          },
        }));

      // Create new machines for additional tubes
      const newMachines: Machine[] = [];
      for (let i = currentTubeCount + 1; i <= numTubes; i++) {
        const newMachine: Machine = {
          id: `${machine.id}_tube${i}_${Date.now()}`,
          fullDetails: machine.fullDetails,
          make: machine.make,
          model: machine.model,
          serial: machine.serial,
          type: machine.type,
          inspectionType: machine.inspectionType,
          location: `${baseLocation} (${i})`,
          registrantName: machine.registrantName,
          entityId: machine.entityId,
          data: { tube_no: String(i), num_tubes: String(numTubes) },
          isComplete: false,
        };
        newMachines.push(newMachine);
      }

      // Update state with all changes
      setMachines((prev) => {
        let updated = prev.map((m) => {
          if (m.id === machine.id) return updatedOriginal;
          const sibling = updatedSiblings.find((s) => s.id === m.id);
          return sibling || m;
        });
        return [...updated, ...newMachines];
      });

      // Save to Firestore
      saveMachineToFirestore(updatedOriginal);
      updatedSiblings.forEach((m) => saveMachineToFirestore(m));
      newMachines.forEach((m) => saveMachineToFirestore(m));
    }
  };

  const handleBackFromInspection = () => {
    if (activeMachineId) {
      // Use functional update to get the latest machine data from state
      // This ensures we have the most recent num_tubes value after updateField
      let currentMachine: Machine | undefined;
      setMachines((prev) => {
        currentMachine = prev.find((m) => m.id === activeMachineId);
        return prev; // No changes, just reading
      });

      if (currentMachine) {
        handleMultiTubeSync(currentMachine);
      }
    }
    setActiveMachineId(null);
    setView("machine-list");
  };

  // --- DATA PREPARATION HELPER ---
  const getMachineData = (machine: Machine) => {
    // Remove (R) or (F) suffix from location for R&F combo machines
    // Also remove tube number suffixes like (1), (2), (3), (4)
    const cleanLocation = machine.location
      .replace(/ \([RF]\)$/, "")
      .replace(/ \(\d\)$/, "");

    let finalData: any = {
      inspector: "RH",
      make: machine.make,
      model: machine.model,
      serial: machine.serial,
      "registration number": cleanLocation,
      "registrant name": machine.registrantName,
      date: new Date().toLocaleDateString(),
      details: machine.fullDetails,
      credential: cleanLocation,
      type: (machine.type || "").toUpperCase(),
      ...machine.data,
    };

    if (!finalData["tube_no"]) finalData["tube_no"] = "1";
    if (
      (machine.inspectionType === "general" ||
        machine.inspectionType === "fluoroscope" ||
        machine.inspectionType === "ct") &&
      !finalData["num_tubes"]
    )
      finalData["num_tubes"] = "1";
    // --- NO DATA LOGIC ---
    if (machine.data.noDataReason) {
      const blankFields = (keys: string[]) =>
        keys.forEach((k) => (finalData[k] = ""));
      if (machine.inspectionType === "dental") {
        blankFields([
          "kvp",
          "mR1",
          "time1",
          "hvl",
          "mR2",
          "time2",
          "mR3",
          "time3",
          "mR4",
          "time4",
          "6 foot",
          "operator location",
          "preset_kvp",
          "preset_mas",
          "preset_time",
          "preset kvp",
          "preset mas",
          "preset time",
        ]);
        finalData["preset kvp"] = machine.data.noDataReason;
      } else if (machine.inspectionType === "general") {
        blankFields([
          "g1_kvp",
          "g1_mr",
          "g1_time",
          "g2a_kvp",
          "g2a_mr",
          "g2a_time",
          "g2b_kvp",
          "g2b_mr",
          "g2b_time",
          "g2c_kvp",
          "g2c_mr",
          "g2c_time",
          "g2d_kvp",
          "g2d_mr",
          "g2d_time",
          "g3_kvp",
          "g3_mr",
          "g3_time",
          "g4_kvp",
          "g4_hvl",
          "g5_scatter",
          "g6_scatter",
          "g1_preset_kvp",
          "g1_preset_mas",
          "g1_preset_time",
          "g2_preset_kvp",
          "g2_preset_mas",
          "g2_preset_time",
          "g3_preset_kvp",
          "g3_preset_mas",
          "g3_preset_time",
          "g4_preset_mas",
          "preset_kvp1",
          "mas1",
          "preset_time1",
          "preset_kvp2",
          "mas2",
          "preset_time2",
          "preset_kvp3",
          "mas3",
          "preset_time3",
          "mas4",
          "g1_calc",
          "g2_avg",
          "g2_calc",
          "g3_calc",
          "note",
        ]);
        finalData["note"] = machine.data.noDataReason;
      } else if (
        machine.inspectionType === "analytical" ||
        machine.inspectionType === "bone_density" ||
        machine.inspectionType === "industrial" // Added here
      ) {
        blankFields(["scatter_6ft", "scatter_operator"]);
        finalData["scatter_6ft"] = machine.data.noDataReason;
      } else if (machine.inspectionType === "fluoroscope") {
        // Only blank inspection data fields, preserve physicist data (pkvp, pma, pr/min, phvl, pname, pdate, etc.)
        blankFields([
          "ma",
          "kvp",
          "r/min",
          "hvl",
          "ma_boost",
          "kvp_boost",
          "r/min_boost",
        ]);
        finalData["kvp"] = machine.data.noDataReason;
      } else if (machine.inspectionType === "ct") {
        // Only blank inspection data fields, preserve physicist data (pname, pdate)
        blankFields(["time", "kvp", "ma", "mas", "operator_scatter"]);
        finalData["time"] = machine.data.noDataReason;
      } else if (machine.inspectionType === "cabinet") {
        blankFields(["entrance", "exit", "operator_scatter"]);
        finalData["entrance"] = machine.data.noDataReason;
      } else if (
        machine.inspectionType === "cbct" ||
        machine.inspectionType === "panoramic"
      ) {
        // CBCT and Panoramic use dental template but only have scatter fields
        blankFields(["6 foot", "operator location"]);
        finalData["6 foot"] = machine.data.noDataReason;
      } else if (machine.inspectionType === "accelerator") {
        blankFields(["door_scatter", "console_scatter"]);
        finalData["door_scatter"] = machine.data.noDataReason;
      }
    } else {
      // --- STANDARD LOGIC ---
      if (machine.inspectionType === "dental") {
        finalData["preset kvp"] = machine.data["preset_kvp"];
        finalData["preset mas"] = machine.data["preset_mas"];
        finalData["preset time"] = machine.data["preset_time"];
        if (!finalData["operator location"])
          finalData["operator location"] = "<1";
      }

      // CBCT and Panoramic use dental template, need presets and scatter defaults
      if (
        machine.inspectionType === "cbct" ||
        machine.inspectionType === "panoramic"
      ) {
        finalData["preset kvp"] = machine.data["preset_kvp"];
        finalData["preset mas"] = machine.data["preset_mas"];
        finalData["preset time"] = machine.data["preset_time"];
        if (!finalData["operator location"])
          finalData["operator location"] = "<1";
      }

      if (machine.inspectionType === "general") {
        finalData["preset_kvp1"] = machine.data["g1_preset_kvp"] || "70";
        finalData["mas1"] = machine.data["g1_preset_mas"] || "10";
        finalData["preset_time1"] = machine.data["g1_preset_time"] || "";
        finalData["preset_kvp2"] = machine.data["g2_preset_kvp"] || "70";
        finalData["mas2"] = machine.data["g2_preset_mas"] || "16";
        finalData["preset_time2"] = machine.data["g2_preset_time"] || "";
        finalData["preset_kvp3"] = machine.data["g3_preset_kvp"] || "70";
        finalData["mas3"] = machine.data["g3_preset_mas"] || "20";
        finalData["preset_time3"] = machine.data["g3_preset_time"] || "";
        finalData["mas4"] = machine.data["g4_preset_mas"] || "40";

        if (!finalData["g6_scatter"]) finalData["g6_scatter"] = "<1";
        if (!finalData["g5_scatter"]) finalData["g5_scatter"] = "<1";
        const g1_mr = parseFloat(machine.data["g1_mr"] || "0");
        const mas1 = parseFloat(finalData["mas1"]);
        finalData["g1_calc"] =
          g1_mr > 0 && mas1 > 0 ? (g1_mr / mas1).toFixed(2) : "";

        const mas2 = parseFloat(finalData["mas2"]);
        const r1 = parseFloat(machine.data["g2a_mr"] || "0");
        const r2 = parseFloat(machine.data["g2b_mr"] || "0");
        const r3 = parseFloat(machine.data["g2c_mr"] || "0");
        const r4 = parseFloat(machine.data["g2d_mr"] || "0");
        let count = 0,
          sum = 0;
        if (r1 > 0) {
          sum += r1;
          count++;
        }
        if (r2 > 0) {
          sum += r2;
          count++;
        }
        if (r3 > 0) {
          sum += r3;
          count++;
        }
        if (r4 > 0) {
          sum += r4;
          count++;
        }

        if (count > 0) {
          const avg = sum / count;
          finalData["g2_avg"] = avg.toFixed(2);
          if (mas2 > 0) finalData["g2_calc"] = (avg / mas2).toFixed(2);
        }

        const g3_mr = parseFloat(machine.data["g3_mr"] || "0");
        const mas3 = parseFloat(finalData["mas3"]);
        finalData["g3_calc"] =
          g3_mr > 0 && mas3 > 0 ? (g3_mr / mas3).toFixed(2) : "";
      }

      if (
        machine.inspectionType === "analytical" ||
        machine.inspectionType === "bone_density" ||
        machine.inspectionType === "industrial" // Added here
      ) {
        if (!finalData["scatter_6ft"]) finalData["scatter_6ft"] = "<1";
        if (!finalData["scatter_operator"])
          finalData["scatter_operator"] = "<1";
      }

      if (machine.inspectionType === "fluoroscope") {
        // Map inputs from steps
        finalData["ma"] = machine.data["f1_preset_mas"];

        // HVL logic: combine Value + KVP
        const hvlVal = machine.data["hvl"] || "";
        const hvlKvp = machine.data["f1_preset_kvp"] || "120"; // CHANGED TO USE F1 PRESET OR 120
        if (hvlVal) {
          finalData["hvl"] = `${hvlVal} @ ${hvlKvp}`;
        } else {
          finalData["hvl"] = "";
        }

        // PHYSICIST HVL LOGIC
        const physHvl = machine.data["phvl"] || "";
        const physHvlKvp = machine.data["phvl_kvp"] || "";
        if (physHvl) {
          finalData["phvl"] = `${physHvl} @ ${physHvlKvp}`;
        }

        // HLC / BOOST MAPPING
        if (machine.data["has_hlc"] === "true") {
          finalData["ma_boost"] = machine.data["f1_boost_preset_mas"];
          finalData["kvp_boost"] = machine.data["kvp_boost"];
          finalData["r/min_boost"] = machine.data["r/min_boost"];
          finalData["pkvp_boost"] = machine.data["pkvp_boost"];
          finalData["pma_boost"] = machine.data["pma_boost"];
          finalData["pr/min_boost"] = machine.data["pr/min_boost"];
        } else {
          // Clear boost data if HLC unchecked
          const boostFields = [
            "ma_boost",
            "kvp_boost",
            "r/min_boost",
            "pkvp_boost",
            "pma_boost",
            "pr/min_boost",
          ];
          boostFields.forEach((f) => (finalData[f] = ""));
        }
      }

      if (machine.inspectionType === "ct") {
        // Only one of mA or mAs is usually filled.
        // Blank out the other.
        if (!machine.data["mas"]) finalData["mas"] = "";
        if (!machine.data["ma"]) finalData["ma"] = "";
        // Default scatter to <1 if empty
        if (!finalData["operator_scatter"])
          finalData["operator_scatter"] = "<1";
      }

      if (machine.inspectionType === "cabinet") {
        if (!finalData["entrance"]) finalData["entrance"] = "<1";
        if (!finalData["exit"]) finalData["exit"] = "<1";
        if (!finalData["operator_scatter"])
          finalData["operator_scatter"] = "<1";
      }

      if (machine.inspectionType === "accelerator") {
        if (!finalData["door_scatter"]) finalData["door_scatter"] = "<1";
        if (!finalData["console_scatter"]) finalData["console_scatter"] = "<1";
        // Map manual entry fields to template tags
        finalData["num_tubes"] = machine.data["num_tubes"] || "";
        finalData["max"] = machine.data["max_energy"] || "";
        finalData["required"] = machine.data["license_required"] || "";
        finalData["license"] = machine.data["license_number"] || "";
        finalData["rso"] = machine.data["rso_name"] || "";
        finalData["onboard"] = machine.data["onboard_imaging"] || "";
        finalData["door"] = machine.data["door_scatter"] || "<1";
        finalData["console"] = machine.data["console_scatter"] || "<1";
      }
    }
    return finalData;
  };

  // --- DOWNLOAD ZIP HANDLER (SCOPED TO ACTIVE FACILITY) ---
  const handleDownloadZip = (targetEntityId: string) => {
    const facilityMachines = machines.filter(
      (m) => m.entityId === targetEntityId
    );
    if (facilityMachines.length === 0) return;

    const zip = new PizZip();
    try {
      let zipFilename = "Inspections.zip";
      // Use the facility name from the first machine for the filename
      const entityName = facilityMachines[0]?.registrantName || "Facility";
      const safeName = entityName
        .replace(/[^a-z0-9]/gi, "_")
        .replace(/_{2,}/g, "_");
      zipFilename = `${safeName}_Machine_Pages.zip`;

      facilityMachines.forEach((machine) => {
        if (!machine.isComplete) return;

        // CBCT and Panoramic use the dental template
        const templateType =
          machine.inspectionType === "cbct" ||
          machine.inspectionType === "panoramic"
            ? "dental"
            : machine.inspectionType;
        const templateBuffer = templates[templateType];
        if (!templateBuffer) return;

        const data = getMachineData(machine);

        const zipDoc = new PizZip(templateBuffer);
        const doc = new Docxtemplater(zipDoc, {
          paragraphLoop: true,
          linebreaks: true,
          nullGetter: () => "",
        });
        doc.render(data);
        const blob = doc.getZip().generate({ type: "arraybuffer" });

        zip.file(`Inspection_${machine.location}.docx`, blob);
      });
      const content = zip.generate({ type: "blob" });
      saveAs(content, zipFilename);
    } catch (e) {
      console.error(e);
      alert("Error generating bulk zip. Check templates.");
    }
  };

  // --- DOWNLOAD HISTORY ZIP ---
  const handleDownloadHistoryZip = (entry: HistoryEntry) => {
    const completedMachines = entry.machines.filter((m) => m.isComplete);
    if (completedMachines.length === 0) {
      alert("No completed machines to download.");
      return;
    }

    const zip = new PizZip();
    try {
      const safeName = entry.facilityName
        .replace(/[^a-z0-9]/gi, "_")
        .replace(/_{2,}/g, "_");
      const zipFilename = `${safeName}_History.zip`;

      completedMachines.forEach((machine) => {
        const templateType =
          machine.inspectionType === "cbct" ||
          machine.inspectionType === "panoramic"
            ? "dental"
            : machine.inspectionType;
        const templateBuffer = templates[templateType];
        if (!templateBuffer) return;

        const data = getMachineData(machine);

        const zipDoc = new PizZip(templateBuffer);
        const doc = new Docxtemplater(zipDoc, {
          paragraphLoop: true,
          linebreaks: true,
          nullGetter: () => "",
        });
        doc.render(data);
        const blob = doc.getZip().generate({ type: "arraybuffer" });

        zip.file(`Inspection_${machine.location}.docx`, blob);
      });

      const content = zip.generate({ type: "blob" });
      saveAs(content, zipFilename);
    } catch (e) {
      console.error(e);
      alert("Error generating history zip. Check templates.");
    }
  };

  const generateDoc = (machine: Machine) => {
    // CBCT and Panoramic use the dental template
    const templateType =
      machine.inspectionType === "cbct" ||
      machine.inspectionType === "panoramic"
        ? "dental"
        : machine.inspectionType;
    const selectedTemplate = templates[templateType];
    if (!selectedTemplate) {
      alert(
        `Please upload the ${
          templateType === "dental" ? "Dental" : "Gen Rad"
        } Template in Settings!`
      );
      return;
    }
    const finalData = getMachineData(machine);
    createWordDoc(
      selectedTemplate,
      finalData,
      `Inspection_${machine.location}.docx`
    );
  };

  // --- FACILITY HELPERS ---
  const getFacilities = () => {
    const groups: {
      [key: string]: {
        name: string;
        entityId: string;
        count: number;
        complete: number;
      };
    } = {};
    machines.forEach((m) => {
      // Group by entityId to handle facilities with the same name but different entity IDs
      if (!groups[m.entityId]) {
        groups[m.entityId] = {
          name: m.registrantName,
          entityId: m.entityId,
          count: 0,
          complete: 0,
        };
      }
      groups[m.entityId].count++;
      if (m.isComplete) groups[m.entityId].complete++;
    });
    // Sort by entityId numerically (handles IDs starting with 0 like "0108")
    return Object.values(groups).sort((a, b) => {
      const numA = parseInt(a.entityId, 10);
      const numB = parseInt(b.entityId, 10);
      // If both are valid numbers, sort numerically
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      // Fall back to string comparison for non-numeric IDs
      return a.entityId.localeCompare(b.entityId);
    });
  };

  const deleteFacility = async (
    entityId: string,
    facilityName: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (
      window.confirm(`Delete facility "${facilityName}" and all its machines?`)
    ) {
      // Archive to history before deleting
      await archiveFacilityToHistory(entityId, facilityName);

      // Get machines to delete from Firestore
      const machinesToDelete = machines.filter((m) => m.entityId === entityId);
      machinesToDelete.forEach((m) => deleteMachineFromFirestore(m.id));
      setMachines((prev) => prev.filter((m) => m.entityId !== entityId));
    }
  };

  const deleteAllFacilities = () => {
    if (window.confirm("Are you sure you want to clear ALL facilities?")) {
      // Delete all machines from Firestore
      machines.forEach((m) => deleteMachineFromFirestore(m.id));
      setMachines([]);
    }
  };

  const activeMachine = machines.find((m) => m.id === activeMachineId);
  // DETERMINE STEPS BASED ON TYPE
  let currentSteps = DENTAL_STEPS;
  if (activeMachine?.inspectionType === "general") currentSteps = GENERAL_STEPS;
  if (activeMachine?.inspectionType === "analytical")
    currentSteps = ANALYTICAL_STEPS;
  if (activeMachine?.inspectionType === "bone_density")
    currentSteps = BONE_DENSITY_STEPS;
  if (activeMachine?.inspectionType === "industrial")
    currentSteps = INDUSTRIAL_STEPS;
  if (activeMachine?.inspectionType === "cbct") currentSteps = CBCT_STEPS;
  if (activeMachine?.inspectionType === "panoramic")
    currentSteps = PANORAMIC_STEPS;
  if (activeMachine?.inspectionType === "fluoroscope") {
    const hasHLC = activeMachine.data["has_hlc"] === "true";

    // BUILD FLUORO STEPS DYNAMICALLY
    const fluoroSteps = [
      FLUORO_STEPS[0], // 1. Max Exposure (Standard)
    ];

    if (hasHLC) {
      fluoroSteps.push(FLUORO_BOOST_MEASURE_STEP); // 2. Max Exposure (Boost)
    }

    // Removed old step 2 (HVL) as it's merged

    // PHYSICIST DATA (Merged Step)
    const reportStep = {
      ...FLUORO_STEPS[1], // Was index 2, now index 1 in the constant definition list
      label: `${hasHLC ? "3" : "2"}. Physicist Report Data`,
      fields: [...FLUORO_STEPS[1].fields],
      indices: [...FLUORO_STEPS[1].indices],
    };

    if (hasHLC) {
      reportStep.fields.push("pkvp_boost", "pma_boost", "pr/min_boost");
      reportStep.indices.push("pkvp_boost", "pma_boost", "pr/min_boost");
    }

    fluoroSteps.push(reportStep);
    currentSteps = fluoroSteps;
  }
  if (activeMachine?.inspectionType === "ct") currentSteps = CT_STEPS;
  if (activeMachine?.inspectionType === "cabinet") currentSteps = CABINET_STEPS;
  if (activeMachine?.inspectionType === "accelerator")
    currentSteps = ACCELERATOR_STEPS;
  const activeFacilityMachines = machines
    .filter((m) => m.entityId === activeFacilityId)
    .sort((a, b) => a.location.localeCompare(b.location));
  useEffect(() => {
    if (view === "mobile-form" && activeMachine && apiKey) {
      if (
        !activeMachine.make &&
        !activeMachine.model &&
        !activeMachine.serial
      ) {
        parseDetailsWithGemini(activeMachine);
      }
    }
  }, [view, activeMachineId]);

  // --- UI ROUTER ---

  // Auth Loading State
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Login Screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="bg-blue-600 p-3 rounded-xl">
              <ScanLine className="text-white h-8 w-8" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800">RayScan</h1>
          </div>

          <h2 className="text-xl font-bold text-slate-700 mb-6 text-center">
            {authMode === "login" ? "Welcome Back" : "Create Account"}
          </h2>

          {authError && (
            <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg mb-4 text-sm">
              {authError}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                Email
              </label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                Password
              </label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Enter password"
                required
                minLength={6}
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 active:scale-95 transition-all"
            >
              {authMode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="my-6 flex items-center gap-4">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 uppercase">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            onClick={handleGoogleLogin}
            className="w-full py-3 border border-slate-200 rounded-lg font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          <p className="text-center text-sm text-slate-500 mt-6">
            {authMode === "login" ? (
              <>
                Don't have an account?{" "}
                <button
                  onClick={() => setAuthMode("signup")}
                  className="text-blue-600 font-bold hover:underline"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => setAuthMode("login")}
                  className="text-blue-600 font-bold hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (view === "settings")
    return (
      <div className="min-h-screen bg-slate-50 p-6 font-sans">
        <button
          onClick={() => setView("facility-list")}
          className="mb-6 flex gap-2 font-bold text-slate-600 active:scale-95 transition-transform"
        >
          <ArrowLeft /> Back
        </button>
        <h1 className="text-2xl font-bold mb-4 text-slate-800">Settings</h1>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setSettingsTab("apiKey")}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
              settingsTab === "apiKey"
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <Key size={16} />
              API Key
            </div>
          </button>
          <button
            onClick={() => setSettingsTab("templates")}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
              settingsTab === "templates"
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText size={16} />
              Templates
            </div>
          </button>
          <button
            onClick={() => setSettingsTab("history")}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
              settingsTab === "history"
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <Clock size={16} />
              History
            </div>
          </button>
        </div>

        <div className="space-y-6">
          {/* API Key Tab Content */}
          {settingsTab === "apiKey" && (
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Key className="text-blue-500" size={20} />
                <h3 className="font-bold text-slate-700">Gemini API Key</h3>
              </div>

              <input
                type="text"
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder="Paste your AIza... key here"
                className="w-full p-3 border rounded bg-slate-50 text-slate-600 font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />

              <p className="text-[11px] text-slate-400 mt-2">
                Key is saved locally in your browser.
              </p>
            </div>
          )}

          {/* Templates Tab Content */}
          {settingsTab === "templates" && (
            <>
              {/* UPDATED TEMPLATE UPLOAD AREA */}
              <div
                onDragOver={handleTemplateDragOver}
                onDragLeave={handleTemplateDragLeave}
                onDrop={handleTemplateDrop}
                className={`border-2 border-dashed p-8 text-center rounded-xl relative transition-colors active:scale-95 cursor-pointer ${
                  isTemplateDragging
                    ? "bg-blue-50 border-blue-500 ring-2 ring-blue-200"
                    : "bg-white hover:bg-slate-50 border-slate-200"
                }`}
              >
                <label className="block w-full h-full cursor-pointer flex flex-col items-center justify-center gap-3">
                  <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                    <UploadCloud size={24} />
                  </div>
                  <div>
                    <p className="text-blue-800 font-bold text-lg">
                      {isTemplateDragging
                        ? "Drop Templates Here"
                        : "Upload Templates"}
                    </p>
                    {/* Subtitle removed as requested */}
                  </div>
                  <input
                    type="file"
                    accept=".docx"
                    multiple
                    onChange={handleBulkTemplateUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <div className="space-y-2">
                {/* DENTAL */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.dental
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.dental
                          ? "bg-emerald-200 text-emerald-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <Smile size={16} />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.dental
                            ? "text-emerald-900"
                            : "text-slate-500"
                        }`}
                      >
                        Dental Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.dental}
                      </p>
                    </div>
                  </div>
                  {templates.dental && (
                    <button
                      onClick={(e) => removeTemplate("dental", e)}
                      className="p-2 bg-white text-red-500 rounded hover:bg-red-50 border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* GENERAL */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.general
                      ? "bg-purple-50 border-purple-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.general
                          ? "bg-purple-200 text-purple-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <Zap size={16} />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.general
                            ? "text-purple-900"
                            : "text-slate-500"
                        }`}
                      >
                        General Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.general}
                      </p>
                    </div>
                  </div>
                  {templates.general && (
                    <button
                      onClick={(e) => removeTemplate("general", e)}
                      className="p-2 bg-white text-red-500 rounded hover:bg-red-50 border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* ANALYTICAL */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.analytical
                      ? "bg-orange-50 border-orange-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.analytical
                          ? "bg-orange-200 text-orange-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <Microscope size={16} />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.analytical
                            ? "text-orange-900"
                            : "text-slate-500"
                        }`}
                      >
                        Analytical Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.analytical}
                      </p>
                    </div>
                  </div>
                  {templates.analytical && (
                    <button
                      onClick={(e) => removeTemplate("analytical", e)}
                      className="p-2 bg-white text-red-500 rounded hover:bg-red-50 border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* BONE DENSITY */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.bone_density
                      ? "bg-pink-50 border-pink-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.bone_density
                          ? "bg-pink-200 text-pink-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <Bone size={16} />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.bone_density
                            ? "text-pink-900"
                            : "text-slate-500"
                        }`}
                      >
                        Bone Density Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.bone_density}
                      </p>
                    </div>
                  </div>
                  {templates.bone_density && (
                    <button
                      onClick={(e) => removeTemplate("bone_density", e)}
                      className="p-2 bg-white text-red-500 rounded hover:bg-red-50 border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* FLUOROSCOPE */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.fluoroscope
                      ? "bg-blue-50 border-blue-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.fluoroscope
                          ? "bg-blue-200 text-blue-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <Activity size={16} />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.fluoroscope
                            ? "text-blue-900"
                            : "text-slate-500"
                        }`}
                      >
                        Fluoroscope Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.fluoroscope}
                      </p>
                    </div>
                  </div>
                  {templates.fluoroscope && (
                    <button
                      onClick={(e) => removeTemplate("fluoroscope", e)}
                      className="p-2 bg-white text-red-500 rounded hover:bg-red-50 border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* CT */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.ct
                      ? "bg-teal-50 border-teal-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.ct
                          ? "bg-teal-200 text-teal-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <Scan size={16} />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.ct ? "text-teal-900" : "text-slate-500"
                        }`}
                      >
                        CT Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.ct}
                      </p>
                    </div>
                  </div>
                  {templates.ct && (
                    <button
                      onClick={(e) => removeTemplate("ct", e)}
                      className="p-2 bg-white text-red-500 rounded hover:bg-red-50 border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* INDUSTRIAL RADIOGRAPHY TEMPLATE SLOT */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.industrial
                      ? "bg-amber-50 border-amber-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.industrial
                          ? "bg-amber-200 text-amber-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <Radio size={16} /> {/* Unique symbol for Industrial */}
                    </div>
                    {/* ... rest of the slot code */}
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.industrial
                            ? "text-amber-900"
                            : "text-slate-500"
                        }`}
                      >
                        Industrial Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.industrial || "No Template"}
                      </p>
                    </div>
                  </div>
                  {templates.industrial && (
                    <button
                      onClick={(e) => removeTemplate("industrial", e)}
                      className="p-2 bg-white text-red-500 rounded border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* CABINET */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.cabinet
                      ? "bg-stone-50 border-stone-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.cabinet
                          ? "bg-stone-200 text-stone-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <Briefcase size={16} />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.cabinet
                            ? "text-stone-900"
                            : "text-slate-500"
                        }`}
                      >
                        Cabinet/Baggage Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.cabinet}
                      </p>
                    </div>
                  </div>
                  {templates.cabinet && (
                    <button
                      onClick={(e) => removeTemplate("cabinet", e)}
                      className="p-2 bg-white text-red-500 rounded hover:bg-red-50 border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {/* ACCELERATOR */}
                <div
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    templates.accelerator
                      ? "bg-red-50 border-red-200"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        templates.accelerator
                          ? "bg-red-200 text-red-700"
                          : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      <AlertCircle size={16} />
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          templates.accelerator
                            ? "text-red-900"
                            : "text-slate-500"
                        }`}
                      >
                        Accelerator Template
                      </p>
                      <p className="text-xs text-slate-400">
                        {templateNames.accelerator}
                      </p>
                    </div>
                  </div>
                  {templates.accelerator && (
                    <button
                      onClick={(e) => removeTemplate("accelerator", e)}
                      className="p-2 bg-white text-red-500 rounded hover:bg-red-50 border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* History Tab Content */}
          {settingsTab === "history" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="text-blue-500" size={20} />
                <h3 className="font-bold text-slate-700">Inspection History</h3>
              </div>
              {inspectionHistory.length === 0 ? (
                <div className="bg-white p-8 rounded-xl border border-slate-200 text-center">
                  <div className="h-12 w-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Clock className="text-slate-400" size={24} />
                  </div>
                  <p className="text-slate-500 font-medium">
                    No inspection history yet
                  </p>
                  <p className="text-slate-400 text-sm mt-1">
                    Completed facilities will appear here
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {inspectionHistory.map((entry) => (
                    <HistoryEntryCard
                      key={entry.id}
                      entry={entry}
                      onDownload={handleDownloadHistoryZip}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  // --- MOBILE FORM VIEW (INSPECTION) ---
  if (view === "mobile-form" && activeMachine)
    return (
      <div className="min-h-screen bg-slate-50 font-sans relative">
        <header className="bg-white p-4 border-b sticky top-0 z-20 shadow-sm">
          <div className="flex gap-3 items-center mb-1">
            <button
              onClick={handleBackFromInspection}
              className="p-2 -ml-2 text-slate-600 hover:bg-slate-50 rounded-full active:scale-95 transition-transform"
            >
              <ArrowLeft size={24} />
            </button>
            <div className="font-bold text-lg text-slate-800">
              {activeMachine.location}
            </div>
          </div>
          <div className="text-xs text-slate-500 ml-11 flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <span
                className={`uppercase font-bold px-2 py-0.5 rounded text-xs ${
                  activeMachine.inspectionType === "general"
                    ? "bg-purple-100 text-purple-700"
                    : activeMachine.inspectionType === "analytical"
                    ? "bg-orange-100 text-orange-700"
                    : activeMachine.inspectionType === "industrial"
                    ? "bg-amber-100 text-amber-700"
                    : activeMachine.inspectionType === "fluoroscope"
                    ? "bg-indigo-100 text-indigo-700"
                    : activeMachine.inspectionType === "ct"
                    ? "bg-teal-100 text-teal-700"
                    : activeMachine.inspectionType === "cabinet"
                    ? "bg-stone-100 text-stone-700"
                    : activeMachine.inspectionType === "bone_density"
                    ? "bg-pink-100 text-pink-700"
                    : activeMachine.inspectionType === "cbct"
                    ? "bg-cyan-100 text-cyan-700"
                    : activeMachine.inspectionType === "panoramic"
                    ? "bg-sky-100 text-sky-700"
                    : activeMachine.inspectionType === "accelerator"
                    ? "bg-red-100 text-red-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {activeMachine.inspectionType.replace("_", " ")}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              {activeMachine.make} - {activeMachine.model} -{" "}
              {activeMachine.serial}
            </div>
          </div>
        </header>

        {/* NO DATA OVERRIDE BANNER */}
        {activeMachine.data.noDataReason && (
          <div className="mx-4 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <AlertCircle
              className="text-amber-500 flex-shrink-0 mt-0.5"
              size={18}
            />
            <div>
              <p className="text-sm font-bold text-amber-800">
                Marked as:{" "}
                {activeMachine.data.noDataReason === "MACHINE NOT OPERATIONAL"
                  ? "Not Operational"
                  : "Not In Facility"}
              </p>
              <p className="text-xs text-amber-600 mt-1">
                To clear this designation, enter inspection data and tap "Update
                Inspection"
              </p>
            </div>
          </div>
        )}

        <div className="p-4 space-y-6">
          {/* MACHINE SETTINGS */}
          <div className="bg-white p-4 rounded border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 text-sm mb-3">
              Machine Settings
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Tube #
                </label>
                <input
                  className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                  placeholder="1"
                  value={activeMachine.data["tube_no"] || ""}
                  onChange={(e) => updateField("tube_no", e.target.value)}
                />
              </div>

              {/* CONDITIONAL SETTINGS BASED ON TYPE */}
              {(activeMachine.inspectionType === "dental" ||
                activeMachine.inspectionType === "cbct" ||
                activeMachine.inspectionType === "panoramic") && (
                <>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      Preset kVp
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="70"
                      value={activeMachine.data["preset_kvp"] || ""}
                      onChange={(e) =>
                        updateField("preset_kvp", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      Preset mAs
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="10"
                      value={activeMachine.data["preset_mas"] || ""}
                      onChange={(e) =>
                        updateField("preset_mas", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      Preset Time
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="0.10"
                      value={activeMachine.data["preset_time"] || ""}
                      onChange={(e) =>
                        updateField("preset_time", e.target.value)
                      }
                    />
                  </div>
                </>
              )}
              {(activeMachine.inspectionType === "general" ||
                activeMachine.inspectionType === "fluoroscope" ||
                activeMachine.inspectionType === "ct") && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">
                    # of Tubes
                  </label>
                  <input
                    className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                    placeholder="1"
                    value={activeMachine.data["num_tubes"] || ""}
                    onChange={(e) => updateField("num_tubes", e.target.value)}
                  />
                </div>
              )}

              {activeMachine.inspectionType === "fluoroscope" && (
                <div className="col-span-2 flex items-center gap-2 mt-2 bg-indigo-50 p-2 rounded border border-indigo-100">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-indigo-600 rounded"
                    checked={activeMachine.data["has_hlc"] === "true"}
                    onChange={(e) =>
                      updateField(
                        "has_hlc",
                        e.target.checked ? "true" : "false"
                      )
                    }
                  />
                  <span className="text-xs font-bold text-indigo-800">
                    Has High Level Control (HLC)?
                  </span>
                </div>
              )}

              {/* ACCELERATOR MANUAL ENTRY FIELDS */}
              {activeMachine.inspectionType === "accelerator" && (
                <>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      # of Tubes
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="1"
                      value={activeMachine.data["num_tubes"] || ""}
                      onChange={(e) => updateField("num_tubes", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      Max Energy
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="18 MV"
                      value={activeMachine.data["max_energy"] || ""}
                      onChange={(e) =>
                        updateField("max_energy", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      License Required
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="Yes/No"
                      value={activeMachine.data["license_required"] || ""}
                      onChange={(e) =>
                        updateField("license_required", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      License Number
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="License #"
                      value={activeMachine.data["license_number"] || ""}
                      onChange={(e) =>
                        updateField("license_number", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      On-Board Imaging
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="Type"
                      value={activeMachine.data["onboard_imaging"] || ""}
                      onChange={(e) =>
                        updateField("onboard_imaging", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      RSO Name
                    </label>
                    <input
                      className="w-full p-2.5 border rounded text-sm font-bold text-slate-700"
                      placeholder="RSO Name"
                      value={activeMachine.data["rso_name"] || ""}
                      onChange={(e) => updateField("rso_name", e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* AI DEBUG AREA */}
          {/* Hide AI Debug for Manual-Only Types */}
          {activeMachine.inspectionType !== "analytical" &&
            activeMachine.inspectionType !== "bone_density" &&
            activeMachine.inspectionType !== "cabinet" &&
            lastScannedText && (
              <div className="bg-slate-100 p-3 rounded-lg border border-slate-200 text-[10px] font-mono text-slate-500 mb-2 overflow-hidden">
                <div className="font-bold mb-1 text-slate-700">
                  AI Response:
                </div>
                <div className="mt-1 truncate opacity-50">
                  {lastScannedText}
                </div>
              </div>
            )}

          {/* STEPS */}
          {currentSteps.map((step: any) => (
            <div
              key={step.id}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-center mb-4">
                <div className="font-bold text-sm text-blue-900">
                  {step.label}
                </div>
                {/* Only show camera if not a strictly manual step */}
                {!step.isManualEntry && (
                  <label
                    className={`px-4 py-2.5 rounded-lg text-xs font-bold cursor-pointer flex gap-2 items-center shadow-sm active:scale-95 transition-all ${
                      isScanning === step.id
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {isScanning === step.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : step.scanType === "document" ? (
                      <Files size={14} />
                    ) : (
                      <Camera size={14} />
                    )}{" "}
                    {isScanning === step.id ? " scanning..." : "Scan"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple={step.scanType === "document"}
                      capture={
                        step.scanType === "document" ? undefined : "environment"
                      }
                      className="hidden"
                      onChange={(e) =>
                        handleScanClick(
                          e,
                          step.fields,
                          step.indices,
                          step.scanType,
                          step.id
                        )
                      }
                      disabled={isScanning !== null}
                    />
                  </label>
                )}
              </div>

              {/* Step-Specific Settings (Gen Rad / Fluoro) */}
              {step.showSettings && (
                <div className="mb-4 bg-slate-50 p-2 rounded flex gap-2">
                  {/* SPECIALIZED INPUTS FOR FLUORO STEP 1 & BOOST */}
                  {step.id === "f1" || step.id === "f1_boost" ? (
                    <>
                      <div className="flex-1">
                        <label className="text-[8px] uppercase font-bold text-slate-400">
                          Set kVp
                        </label>
                        <input
                          className="w-full bg-white border rounded px-1 text-xs"
                          placeholder={step.defaultPresets.kvp}
                          value={
                            activeMachine.data[
                              `${step.settingsGroup}_preset_kvp`
                            ] || ""
                          }
                          onChange={(e) =>
                            updateField(
                              `${step.settingsGroup}_preset_kvp`,
                              e.target.value
                            )
                          }
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[8px] uppercase font-bold text-slate-400">
                          Set mA
                        </label>
                        <input
                          className="w-full bg-white border rounded px-1 text-xs"
                          placeholder={step.defaultPresets.mas}
                          value={
                            activeMachine.data[
                              `${step.settingsGroup}_preset_mas`
                            ] || ""
                          }
                          onChange={(e) =>
                            updateField(
                              `${step.settingsGroup}_preset_mas`,
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </>
                  ) : (
                    // STANDARD INPUTS FOR GENERAL RAD
                    <>
                      <div className="flex-1">
                        <label className="text-[8px] uppercase font-bold text-slate-400">
                          Set kVp
                        </label>
                        <input
                          className="w-full bg-white border rounded px-1 text-xs"
                          placeholder={
                            step.defaultPresets.kvp || step.defaultPresets.mas
                          }
                          value={
                            activeMachine.data[
                              `${step.settingsGroup}_preset_kvp`
                            ] || ""
                          }
                          onChange={(e) =>
                            updateField(
                              `${step.settingsGroup}_preset_kvp`,
                              e.target.value
                            )
                          }
                        />
                      </div>

                      {/* General Rad extra fields */}
                      {activeMachine.inspectionType === "general" && (
                        <>
                          <div className="flex-1">
                            <label className="text-[8px] uppercase font-bold text-slate-400">
                              Set mAs
                            </label>
                            <input
                              className="w-full bg-white border rounded px-1 text-xs"
                              placeholder={step.defaultPresets.mas}
                              value={
                                activeMachine.data[
                                  `${step.settingsGroup}_preset_mas`
                                ] || ""
                              }
                              onChange={(e) =>
                                updateField(
                                  `${step.settingsGroup}_preset_mas`,
                                  e.target.value
                                )
                              }
                            />
                          </div>
                          {step.defaultPresets.time !== null && (
                            <div className="flex-1">
                              <label className="text-[8px] uppercase font-bold text-slate-400">
                                Set Time
                              </label>
                              <input
                                className="w-full bg-white border rounded px-1 text-xs"
                                placeholder="-"
                                value={
                                  activeMachine.data[
                                    `${step.settingsGroup}_preset_time`
                                  ] || ""
                                }
                                onChange={(e) =>
                                  updateField(
                                    `${step.settingsGroup}_preset_time`,
                                    e.target.value
                                  )
                                }
                              />
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {step.fields.map((k: string) => (
                  <div key={k}>
                    <label className="text-[9px] font-bold text-slate-400 uppercase mb-1 block">
                      {getFieldLabel(k)}
                    </label>
                    <div className="relative">
                      <input
                        value={activeMachine.data[k] || ""}
                        onChange={(e) => updateField(k, e.target.value)}
                        className="w-full font-mono text-lg border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-transparent transition-colors py-1"
                        placeholder="-"
                      />
                      {/* PENCIL SYMBOL REMOVED HERE */}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* --- FOOTER --- */}
        <div className="w-full p-4 bg-white border-t shadow-[0_-4px_20px_rgba(0,0,0,0.05)] mt-6 flex justify-center gap-3">
          <button
            onClick={() => setShowNoDataModal(true)}
            className="px-6 py-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-full shadow-sm active:scale-95 transition-transform flex items-center gap-2 text-sm border border-red-200"
          >
            <XCircle size={18} />
            No Data
          </button>

          <button
            onClick={markAsComplete}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-full shadow-lg active:scale-95 transition-transform flex items-center gap-2 text-sm"
          >
            <CheckCircle size={18} />
            {activeMachine.isComplete
              ? "Update Inspection"
              : "Complete Inspection"}
          </button>
        </div>

        {/* --- NO DATA MODAL --- */}
        {showNoDataModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-6 text-center border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800">
                  Reason for No Data
                </h3>
              </div>
              <div className="p-4 flex flex-col gap-3">
                <button
                  onClick={() => handleNoData("operational")}
                  className="p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl font-bold text-slate-700 text-left active:scale-95 transition-transform"
                >
                  Machine Not Operational
                </button>
                <button
                  onClick={() => handleNoData("facility")}
                  className="p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl font-bold text-slate-700 text-left active:scale-95 transition-transform"
                >
                  Machine Not In Facility
                </button>
              </div>
              <div className="p-4 pt-0">
                <button
                  onClick={() => setShowNoDataModal(false)}
                  className="w-full py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  // --- MACHINE LIST VIEW (Specific Facility) ---
  if (view === "machine-list")
    return (
      <div className="min-h-screen bg-slate-50 p-4 font-sans relative">
        <header className="flex justify-between items-center mb-8">
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setView("facility-list")}
              className="p-2 -ml-2 text-slate-600 hover:bg-slate-50 rounded-full active:scale-95 transition-transform"
            >
              <ArrowLeft size={24} />
            </button>
            <div className="flex flex-col">
              <h1 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                Facility
              </h1>
              <div className="text-lg font-bold text-slate-800 leading-tight">
                {activeFacilityMachines[0]?.registrantName || activeFacilityId}
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowMachineMenu(true)}
            className="p-2 bg-white border border-slate-200 rounded-full hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
          >
            <MoreVertical className="text-slate-600 h-5 w-5" />
          </button>
        </header>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-8">
          <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Machines ({activeFacilityMachines.length})
            </span>
          </div>
          {activeFacilityMachines.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              No machines found for this facility.
            </div>
          ) : (
            <div>
              {activeFacilityMachines.map((m) => (
                <div
                  key={m.id}
                  onClick={() => {
                    if (!m.isComplete) {
                      setActiveMachineId(m.id);
                      setView("mobile-form", true);
                    }
                  }}
                  className={`p-4 border-b border-slate-50 flex justify-between items-center last:border-0 transition-colors ${
                    m.isComplete
                      ? m.data.noDataReason
                        ? "bg-amber-50"
                        : "bg-emerald-50"
                      : "hover:bg-slate-50 cursor-pointer"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-bold text-sm text-slate-800 truncate">
                        {m.location}
                      </div>
                      {m.data.note && (
                        <FileText
                          size={12}
                          className="text-amber-500 flex-shrink-0"
                        />
                      )}
                    </div>
                    <div className="flex gap-2 items-center mt-1 flex-wrap">
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          m.inspectionType === "general"
                            ? "bg-purple-100 text-purple-700"
                            : m.inspectionType === "analytical"
                            ? "bg-orange-100 text-orange-700"
                            : m.inspectionType === "industrial"
                            ? "bg-amber-100 text-amber-700"
                            : m.inspectionType === "fluoroscope"
                            ? "bg-indigo-100 text-indigo-700"
                            : m.inspectionType === "ct"
                            ? "bg-teal-100 text-teal-700"
                            : m.inspectionType === "cabinet"
                            ? "bg-stone-100 text-stone-700"
                            : m.inspectionType === "bone_density"
                            ? "bg-pink-100 text-pink-700"
                            : m.inspectionType === "cbct"
                            ? "bg-cyan-100 text-cyan-700"
                            : m.inspectionType === "panoramic"
                            ? "bg-sky-100 text-sky-700"
                            : m.inspectionType === "accelerator"
                            ? "bg-red-100 text-red-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {m.inspectionType.replace("_", " ")}
                      </span>
                      <span className="text-xs text-slate-500 truncate">
                        {m.fullDetails}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {m.data.noDataReason && (
                      <span className="text-[9px] font-bold uppercase px-2 py-1 rounded bg-amber-100 text-amber-700">
                        {m.data.noDataReason === "MACHINE NOT OPERATIONAL"
                          ? "NOT OPERATIONAL"
                          : "NOT IN FACILITY"}
                      </span>
                    )}
                    {m.isComplete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          generateDoc(m);
                        }}
                        className="bg-emerald-100 p-2 rounded-full text-emerald-600 hover:bg-emerald-200 transition-colors"
                        title="Download Report"
                      >
                        <Download size={18} />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMachineMenuId(m.id);
                      }}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                    >
                      <MoreVertical size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* --- HEADER MENU MODAL --- */}
        {showMachineMenu && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 text-center">
                  Options
                </h3>
              </div>
              <div className="p-2 space-y-1">
                <button
                  onClick={() => {
                    setShowMachineMenu(false);
                    setShowXXMachineModal(true);
                  }}
                  className="w-full p-4 text-left hover:bg-slate-50 rounded-xl font-medium text-slate-700 transition-colors"
                >
                  Add XX Machine
                </button>
              </div>
              <div className="p-4 pt-2">
                <button
                  onClick={() => setShowMachineMenu(false)}
                  className="w-full py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- PER-MACHINE MENU MODAL --- */}
        {machineMenuId && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 text-center">
                  Machine Options
                </h3>
              </div>
              <div className="p-2 space-y-1">
                {machines.find((m) => m.id === machineMenuId)?.isComplete && (
                  <button
                    onClick={() => {
                      setActiveMachineId(machineMenuId);
                      setMachineMenuId(null);
                      setView("mobile-form", true);
                    }}
                    className="w-full p-4 text-left hover:bg-slate-50 rounded-xl font-medium text-slate-700 transition-colors flex items-center gap-3"
                  >
                    <Edit3 size={18} className="text-blue-500" />
                    Edit Inspection
                  </button>
                )}
                <button
                  onClick={() => {
                    const machine = machines.find(
                      (m) => m.id === machineMenuId
                    );
                    setNotesText(machine?.data.note || "");
                    setShowNotesModal(true);
                  }}
                  className="w-full p-4 text-left hover:bg-slate-50 rounded-xl font-medium text-slate-700 transition-colors flex items-center gap-3"
                >
                  <FileText size={18} className="text-amber-500" />
                  Notes
                  {machines.find((m) => m.id === machineMenuId)?.data.note && (
                    <span className="text-xs text-amber-500 ml-auto">
                      Has notes
                    </span>
                  )}
                </button>
                <button
                  onClick={() => {
                    setSelectedMachineForTypeChange(machineMenuId);
                    setMachineMenuId(null);
                    setShowTypeSelector(true);
                  }}
                  className="w-full p-4 text-left hover:bg-slate-50 rounded-xl font-medium text-slate-700 transition-colors flex items-center gap-3"
                >
                  <Settings size={18} className="text-slate-500" />
                  Change Machine Type
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm("Are you sure you want to delete this machine?")
                    ) {
                      deleteMachine(machineMenuId);
                      setMachineMenuId(null);
                    }
                  }}
                  className="w-full p-4 text-left hover:bg-red-50 rounded-xl font-medium text-red-600 transition-colors flex items-center gap-3"
                >
                  <Trash2 size={18} />
                  Delete Machine
                </button>
              </div>
              <div className="p-4 pt-2">
                <button
                  onClick={() => setMachineMenuId(null)}
                  className="w-full py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- NOTES MODAL --- */}
        {showNotesModal && machineMenuId && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 text-center">
                  Notes
                </h3>
              </div>
              <div className="p-4">
                <textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="Add notes about this machine..."
                  className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  rows={5}
                  autoFocus
                />
              </div>
              <div className="p-4 pt-0 flex gap-2">
                <button
                  onClick={() => {
                    setShowNotesModal(false);
                    setNotesText("");
                  }}
                  className="flex-1 py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-lg border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const machine = machines.find(
                      (m) => m.id === machineMenuId
                    );
                    if (machine) {
                      const updated = {
                        ...machine,
                        data: { ...machine.data, note: notesText },
                      };
                      setMachines((prev) =>
                        prev.map((m) => (m.id === machineMenuId ? updated : m))
                      );
                      saveMachineToFirestore(updated);
                    }
                    setShowNotesModal(false);
                    setMachineMenuId(null);
                    setNotesText("");
                  }}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold text-sm rounded-lg hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- MACHINE SELECTOR MODAL --- */}
        {showMachineSelector && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[80vh] flex flex-col">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 text-center">
                  Select Machine
                </h3>
              </div>
              <div className="p-2 overflow-y-auto flex-1">
                {activeFacilityMachines.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedMachineForTypeChange(m.id);
                      setShowMachineSelector(false);
                      setShowTypeSelector(true);
                    }}
                    className="w-full p-3 text-left hover:bg-slate-50 rounded-xl transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-sm text-slate-800">
                        {m.location}
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded inline-block mt-1 ${
                          m.inspectionType === "general"
                            ? "bg-purple-100 text-purple-700"
                            : m.inspectionType === "analytical"
                            ? "bg-orange-100 text-orange-700"
                            : m.inspectionType === "industrial"
                            ? "bg-amber-100 text-amber-700"
                            : m.inspectionType === "fluoroscope"
                            ? "bg-indigo-100 text-indigo-700"
                            : m.inspectionType === "ct"
                            ? "bg-teal-100 text-teal-700"
                            : m.inspectionType === "cabinet"
                            ? "bg-stone-100 text-stone-700"
                            : m.inspectionType === "bone_density"
                            ? "bg-pink-100 text-pink-700"
                            : m.inspectionType === "cbct"
                            ? "bg-cyan-100 text-cyan-700"
                            : m.inspectionType === "panoramic"
                            ? "bg-sky-100 text-sky-700"
                            : m.inspectionType === "accelerator"
                            ? "bg-red-100 text-red-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {m.inspectionType.replace("_", " ")}
                      </span>
                    </div>
                    <ChevronRight className="text-slate-300 h-4 w-4" />
                  </button>
                ))}
              </div>
              <div className="p-4 pt-2 border-t border-slate-100">
                <button
                  onClick={() => setShowMachineSelector(false)}
                  className="w-full py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- TYPE SELECTOR MODAL --- */}
        {showTypeSelector && selectedMachineForTypeChange && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 text-center">
                  Change Machine Type
                </h3>
              </div>
              <div className="p-4">
                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                  Machine Type
                </label>
                <select
                  value={`${typeChangeSelection.inspectionType}|${typeChangeSelection.typeLabel}`}
                  onChange={(e) => {
                    const [inspType, typeLabel] = e.target.value.split("|");
                    setTypeChangeSelection({
                      inspectionType: inspType as InspectionType,
                      typeLabel: typeLabel,
                    });
                  }}
                  className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                >
                  <optgroup label="Dental">
                    <option value="dental|Intraoral">Intraoral</option>
                    <option value="dental|Intraoral Mobile">
                      Intraoral Mobile
                    </option>
                    <option value="dental|Intraoral Hand Held">
                      Intraoral Hand Held
                    </option>
                  </optgroup>
                  <optgroup label="CBCT">
                    <option value="cbct|CBCT">CBCT</option>
                  </optgroup>
                  <optgroup label="Panoramic">
                    <option value="panoramic|Panoramic">Panoramic</option>
                    <option value="panoramic|Panoramic CT">Panoramic CT</option>
                  </optgroup>
                  <optgroup label="Radiographic">
                    <option value="general|Radiographic">Radiographic</option>
                    <option value="general|Radiographic Mobile">
                      Radiographic Mobile
                    </option>
                    <option value="general|U-Arm">U-Arm</option>
                  </optgroup>
                  <optgroup label="Fluoroscope">
                    <option value="fluoroscope|C-Arm">C-Arm</option>
                    <option value="fluoroscope|Mobile C-Arm">
                      Mobile C-Arm
                    </option>
                    <option value="fluoroscope|Fluoroscopic">
                      Fluoroscopic
                    </option>
                    <option value="fluoroscope|O-Arm">O-Arm</option>
                  </optgroup>
                  <optgroup label="CT">
                    <option value="ct|CT">CT</option>
                    <option value="ct|CT/PET">CT/PET</option>
                  </optgroup>
                  <optgroup label="Analytical">
                    <option value="analytical|Electron Microscope">
                      Electron Microscope
                    </option>
                    <option value="analytical|X-Ray Diffraction">
                      X-Ray Diffraction
                    </option>
                    <option value="analytical|X-Ray Fluorescence">
                      X-Ray Fluorescence
                    </option>
                  </optgroup>
                  <optgroup label="Other">
                    <option value="bone_density|Bone Density">
                      Bone Density
                    </option>
                    <option value="cabinet|Cabinet">Cabinet</option>
                    <option value="industrial|Industrial Radiography">
                      Industrial Radiography
                    </option>
                    <option value="combination_rf|Combination - R&F">
                      Combination - R&F
                    </option>
                    <option value="accelerator|Accelerator">Accelerator</option>
                  </optgroup>
                </select>
              </div>
              <div className="p-4 pt-0 flex gap-2">
                <button
                  onClick={() => {
                    setShowTypeSelector(false);
                    setSelectedMachineForTypeChange(null);
                    setTypeChangeSelection({
                      inspectionType: "dental",
                      typeLabel: "Intraoral",
                    });
                  }}
                  className="flex-1 py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-lg border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    updateMachineTypeById(
                      selectedMachineForTypeChange,
                      typeChangeSelection.inspectionType,
                      typeChangeSelection.typeLabel
                    );
                    setTypeChangeSelection({
                      inspectionType: "dental",
                      typeLabel: "Intraoral",
                    });
                  }}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold text-sm rounded-lg hover:bg-blue-700 active:scale-95 transition-all"
                >
                  Change Type
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- XX MACHINE CREATION MODAL --- */}
        {showXXMachineModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 text-center">
                  Add XX Machine
                </h3>
                <p className="text-xs text-slate-400 text-center mt-1">
                  Extra machine not on Excel sheet
                </p>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                    Make
                  </label>
                  <input
                    type="text"
                    value={xxMachineData.make}
                    onChange={(e) =>
                      setXXMachineData((prev) => ({
                        ...prev,
                        make: e.target.value,
                      }))
                    }
                    placeholder="e.g. Gendex"
                    className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                    Model
                  </label>
                  <input
                    type="text"
                    value={xxMachineData.model}
                    onChange={(e) =>
                      setXXMachineData((prev) => ({
                        ...prev,
                        model: e.target.value,
                      }))
                    }
                    placeholder="e.g. 765DC"
                    className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                    Serial
                  </label>
                  <input
                    type="text"
                    value={xxMachineData.serial}
                    onChange={(e) =>
                      setXXMachineData((prev) => ({
                        ...prev,
                        serial: e.target.value,
                      }))
                    }
                    placeholder="e.g. 12345"
                    className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
                    Machine Type
                  </label>
                  <select
                    value={`${xxMachineData.inspectionType}|${xxMachineData.typeLabel}`}
                    onChange={(e) => {
                      const [inspType, typeLabel] = e.target.value.split("|");
                      setXXMachineData((prev) => ({
                        ...prev,
                        inspectionType: inspType as InspectionType,
                        typeLabel: typeLabel,
                      }));
                    }}
                    className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <optgroup label="Dental">
                      <option value="dental|Intraoral">Intraoral</option>
                      <option value="dental|Intraoral Mobile">
                        Intraoral Mobile
                      </option>
                      <option value="dental|Intraoral Hand Held">
                        Intraoral Hand Held
                      </option>
                    </optgroup>
                    <optgroup label="CBCT">
                      <option value="cbct|CBCT">CBCT</option>
                    </optgroup>
                    <optgroup label="Panoramic">
                      <option value="panoramic|Panoramic">Panoramic</option>
                      <option value="panoramic|Panoramic CT">
                        Panoramic CT
                      </option>
                    </optgroup>
                    <optgroup label="Radiographic">
                      <option value="general|Radiographic">Radiographic</option>
                      <option value="general|Radiographic Mobile">
                        Radiographic Mobile
                      </option>
                      <option value="general|U-Arm">U-Arm</option>
                    </optgroup>
                    <optgroup label="Fluoroscope">
                      <option value="fluoroscope|C-Arm">C-Arm</option>
                      <option value="fluoroscope|Mobile C-Arm">
                        Mobile C-Arm
                      </option>
                      <option value="fluoroscope|Fluoroscopic">
                        Fluoroscopic
                      </option>
                      <option value="fluoroscope|O-Arm">O-Arm</option>
                    </optgroup>
                    <optgroup label="CT">
                      <option value="ct|CT">CT</option>
                      <option value="ct|CT/PET">CT/PET</option>
                    </optgroup>
                    <optgroup label="Analytical">
                      <option value="analytical|Electron Microscope">
                        Electron Microscope
                      </option>
                      <option value="analytical|X-Ray Diffraction">
                        X-Ray Diffraction
                      </option>
                      <option value="analytical|X-Ray Fluorescence">
                        X-Ray Fluorescence
                      </option>
                    </optgroup>
                    <optgroup label="Other">
                      <option value="bone_density|Bone Density">
                        Bone Density
                      </option>
                      <option value="cabinet|Cabinet">Cabinet</option>
                      <option value="industrial|Industrial Radiography">
                        Industrial Radiography
                      </option>
                      <option value="combination_rf|Combination - R&F">
                        Combination - R&F
                      </option>
                      <option value="accelerator|Accelerator">
                        Accelerator
                      </option>
                    </optgroup>
                  </select>
                </div>
              </div>
              <div className="p-4 pt-0 flex gap-2">
                <button
                  onClick={() => {
                    setShowXXMachineModal(false);
                    setXXMachineData({
                      make: "",
                      model: "",
                      serial: "",
                      inspectionType: "dental",
                      typeLabel: "Intraoral",
                    });
                  }}
                  className="flex-1 py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-lg border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={createXXMachine}
                  disabled={
                    !xxMachineData.make ||
                    !xxMachineData.model ||
                    !xxMachineData.serial
                  }
                  className="flex-1 py-3 bg-blue-600 text-white font-bold text-sm rounded-lg hover:bg-blue-700 active:scale-95 transition-all disabled:bg-slate-200 disabled:text-slate-400"
                >
                  Add Machine
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  // --- DASHBOARD VIEW (FACILITY LIST) ---
  const facilities = getFacilities();

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans relative">
      <header className="flex justify-between items-center mb-8">
        <div className="flex gap-2 items-center">
          <div className="bg-blue-600 p-2 rounded-lg">
            <ScanLine className="text-white h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">RayScan</h1>
            {currentUser && (
              <p className="text-[10px] text-slate-400 truncate max-w-[150px]">
                {currentUser.email}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView("settings")}
            className="p-2 bg-white border border-slate-200 rounded-full hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
          >
            <Settings className="text-slate-600 h-5 w-5" />
          </button>
          <button
            onClick={() => setShowLogoutModal(true)}
            className="p-2 bg-white border border-slate-200 rounded-full hover:bg-red-50 active:scale-95 transition-all shadow-sm"
            title="Sign Out"
          >
            <LogOut className="text-slate-600 h-5 w-5" />
          </button>
        </div>
      </header>

      {/* LOGOUT CONFIRMATION MODAL */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <LogOut className="text-red-600 h-8 w-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">
                Sign Out?
              </h3>
              <p className="text-slate-500 text-sm">
                Are you sure you want to sign out of RayScan?
              </p>
            </div>
            <div className="p-4 pt-0 flex gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-3 text-slate-600 font-bold text-sm hover:bg-slate-50 rounded-lg border border-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLogoutModal(false);
                  handleLogout();
                }}
                className="flex-1 py-3 bg-red-600 text-white font-bold text-sm rounded-lg hover:bg-red-700 active:scale-95 transition-all"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATS & UPLOAD AREA */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 mb-6 text-center">
        <div className="text-5xl font-bold text-blue-600 mb-2 tracking-tight">
          {facilities.length}
        </div>
        <div className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-6">
          Facilities Loaded
        </div>

        {/* UPDATED EXCEL UPLOAD LABEL */}
        <div className="grid grid-cols-2 gap-3">
          <label
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`col-span-2 py-6 rounded-xl font-bold text-sm cursor-pointer border transition-all active:scale-95
              ${
                isDragging
                  ? "bg-blue-50 border-blue-500 ring-2 ring-blue-200"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200"
              }`}
          >
            <div className="flex justify-center mb-2">
              <FileSpreadsheet size={24} className="text-emerald-600" />
            </div>
            {isDragging ? "Drop Excel Sheets Here" : "Upload Excel Sheets"}
            <input
              type="file"
              accept=".xlsx"
              multiple
              onChange={handleExcelUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* FACILITY LIST CONTAINER */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-8">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Facility List
          </span>

          {/* DELETE ALL BUTTON (Shows if > 2 facilities) */}
          {facilities.length >= 2 && (
            <button
              onClick={deleteAllFacilities}
              className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1 rounded hover:bg-red-50 transition-colors"
            >
              Delete All
            </button>
          )}
        </div>

        {facilities.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            No facilities loaded.
            <br />
            Import an ALiS Excel file to begin.
          </div>
        ) : (
          /* SCROLL REMOVED (max-h-96 removed) */
          <div>
            {facilities.map((fac) => {
              const isCompleted = fac.count > 0 && fac.complete === fac.count;
              return (
                <div
                  key={fac.entityId}
                  onClick={() => {
                    setActiveFacilityId(fac.entityId);
                    setView("machine-list");
                  }}
                  className={`p-4 border-b border-slate-50 flex justify-between items-center last:border-0 transition-colors cursor-pointer ${
                    isCompleted
                      ? "bg-emerald-50 hover:bg-emerald-100"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <div>
                    <div className="flex gap-2 items-center mb-1">
                      <Building2 size={16} className="text-blue-500" />
                      <div className="font-bold text-sm text-slate-800">
                        {fac.name}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <div className="flex items-center gap-1 text-slate-400 text-xs">
                        <MapPin size={12} /> {fac.entityId}
                      </div>
                      <span className="text-xs text-slate-300">•</span>
                      <span className="text-xs text-slate-500">
                        {fac.complete}/{fac.count} Machines
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isCompleted && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadZip(fac.entityId);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg font-bold text-xs active:scale-95 transition-all flex items-center gap-1.5"
                      >
                        <Archive size={14} /> Download
                      </button>
                    )}
                    <button
                      onClick={(e) => deleteFacility(fac.entityId, fac.name, e)}
                      className="text-red-300 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

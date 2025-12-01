import React, { useState, useEffect } from "react";
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
  UploadCloud,
  Edit3,
} from "lucide-react";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";

// --- CONFIG ---
// Your specific Roboflow model
const ROBOFLOW_MODEL_ID = "find-kvps-mrs-times-and-hvls/1";

// --- LOGIC FUNCTIONS ---

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
      alert(
        "Could not find header row 'Inspection Number'. Check Excel format."
      );
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
    });
    doc.render(data);
    const out = doc
      .getZip()
      .generate({
        type: "blob",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    saveAs(out, filename);
  } catch (error) {
    console.error(error);
    alert("Error generating document. Check template tags.");
  }
};

// --- HYBRID SCANNER UTILS ---

// Check if the center of the text block is inside the Roboflow box
const isInside = (
  textPoly: any,
  box: any,
  imgWidth: number,
  imgHeight: number
) => {
  // Google Vision returns vertices [tl, tr, br, bl]
  const vertices = textPoly.vertices;

  // Calculate center of text
  // Note: Vision API coordinates are absolute pixels
  const tx = (vertices[0].x + vertices[2].x) / 2;
  const ty = (vertices[0].y + vertices[2].y) / 2;

  // Roboflow returns x, y (center), width, height
  // BUT: If you sent the image to Roboflow, it usually returns PIXEL coordinates if image dims are known,
  // or normalized coordinates (0-1) if not?
  // The Inference API typically returns pixel coordinates relative to the image sent.
  // Let's assume pixel coordinates.

  const minX = box.x - box.width / 2;
  const maxX = box.x + box.width / 2;
  const minY = box.y - box.height / 2;
  const maxY = box.y + box.height / 2;

  // Simple intersection check
  return tx >= minX && tx <= maxX && ty >= minY && ty <= maxY;
};

// --- MAIN COMPONENT ---

type Machine = {
  id: string;
  fullDetails: string;
  type: string;
  location: string;
  registrantName: string;
  data: { [key: string]: string };
  isComplete: boolean;
};

// DENTAL MAPPINGS
// roboClass: The class name you used in Roboflow (e.g., "kvp", "dose", "time")
const DENTAL_STEPS = [
  {
    id: "scan1",
    label: "1. Technique Scan",
    desc: "Capture All",
    mappings: [
      { field: "kvp", roboClass: "kvp" }, // Assumes you labeled a box "kvp"
      { field: "mR1", roboClass: "dose" },
      { field: "time1", roboClass: "time" },
      { field: "hvl", roboClass: "hvl" },
    ],
  },
  {
    id: "scan2",
    label: "2. Reproducibility",
    desc: "Capture Dose, Time",
    mappings: [
      { field: "mR2", roboClass: "dose" },
      { field: "time2", roboClass: "time" },
    ],
  },
  {
    id: "scan3",
    label: "3. Reproducibility",
    desc: "Capture Dose, Time",
    mappings: [
      { field: "mR3", roboClass: "dose" },
      { field: "time3", roboClass: "time" },
    ],
  },
  {
    id: "scan4",
    label: "4. Reproducibility",
    desc: "Capture Dose, Time",
    mappings: [
      { field: "mR4", roboClass: "dose" },
      { field: "time4", roboClass: "time" },
    ],
  },
  {
    id: "scan5",
    label: "5. Scatter (6ft)",
    desc: "Capture Dose",
    mappings: [{ field: "6 foot", roboClass: "dose" }],
  },
  {
    id: "scan6",
    label: "6. Scatter (Operator)",
    desc: "Capture Dose",
    mappings: [{ field: "operator location", roboClass: "dose" }],
  },
];

export default function RayScanLocal() {
  const [view, setView] = useState<
    "dashboard" | "mobile-list" | "mobile-form" | "settings"
  >("dashboard");
  const [googleKey, setGoogleKey] = useState("");
  const [roboflowKey, setRoboflowKey] = useState("");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [templateFile, setTemplateFile] = useState<ArrayBuffer | null>(null);
  const [templateName, setTemplateName] =
    useState<string>("No Template Loaded");
  const [isScanning, setIsScanning] = useState(false);
  const [debugLog, setDebugLog] = useState<string>("");

  // Setup
  useEffect(() => {
    if (!document.getElementById("tailwind-script")) {
      const script = document.createElement("script");
      script.src = "https://cdn.tailwindcss.com";
      script.id = "tailwind-script";
      document.head.appendChild(script);
    }
    const sG = localStorage.getItem("rs_google");
    const sR = localStorage.getItem("rs_roboflow");
    const sM = localStorage.getItem("rs_machines");
    if (sG) setGoogleKey(sG);
    if (sR) setRoboflowKey(sR);
    if (sM) setMachines(JSON.parse(sM));
  }, []);

  useEffect(() => {
    localStorage.setItem("rs_machines", JSON.stringify(machines));
  }, [machines]);

  const saveKeys = () => {
    localStorage.setItem("rs_google", googleKey);
    localStorage.setItem("rs_roboflow", roboflowKey);
    alert("Keys Saved!");
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTemplateName(file.name);
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result)
          setTemplateFile(evt.target.result as ArrayBuffer);
      };
      reader.readAsArrayBuffer(file);
    }
  };
  const clearTemplate = () => {
    setTemplateFile(null);
    setTemplateName("No Template");
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseExcel(file, (data) => {
      const newMachines: Machine[] = data
        .filter((row: any) => row["Entity Name"] && row["Inspection Number"])
        .filter((row: any) => {
          const name = row["Entity Name"] || "";
          return name.includes("(") && name.includes(")");
        })
        .map((row: any, index: number) => {
          const rawString = row["Entity Name"] || "";
          let fullDetails = "Unknown";
          let facility = rawString;
          if (rawString.includes("(")) {
            const parts = rawString.split("(");
            facility = parts[0].trim();
            fullDetails = parts[1].replace(")", "");
          }
          return {
            id: `mach_${Date.now()}_${index}`,
            fullDetails,
            type: row["Credential Type"] || "Unknown",
            location: row["Credential #"] || facility,
            registrantName: facility,
            data: {},
            isComplete: false,
          };
        });
      setMachines(newMachines);
    });
  };

  // --- HYBRID SCANNER ---
  const performHybridScan = async (
    base64Image: string,
    mappings: { field: string; roboClass: string }[]
  ) => {
    if (!googleKey || !roboflowKey) {
      alert("Missing API Keys! Check Settings.");
      return;
    }
    setIsScanning(true);
    setDebugLog("Starting Hybrid Scan...");

    try {
      const imageContent = base64Image.split(",")[1];

      // 1. Google Vision (Reader)
      const googleRes = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${googleKey}`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                image: { content: imageContent },
                features: [{ type: "TEXT_DETECTION" }],
              },
            ],
          }),
        }
      );
      const googleData = await googleRes.json();
      // [0] is full text, [1..n] are blocks
      const allText = googleData.responses?.[0]?.textAnnotations || [];

      if (allText.length === 0) throw new Error("Google Vision found no text.");

      // 2. Roboflow (Mapper)
      const roboflowRes = await fetch(
        `https://detect.roboflow.com/${ROBOFLOW_MODEL_ID}?api_key=${roboflowKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: imageContent,
        }
      );
      const roboflowData = await roboflowRes.json();
      const predictions = roboflowData.predictions || [];

      if (predictions.length === 0) throw new Error("Roboflow found no boxes.");

      setDebugLog(
        `Found ${allText.length} text blocks & ${predictions.length} boxes.`
      );

      // 3. Match Logic
      const updates: Record<string, string> = {};

      mappings.forEach(({ field, roboClass }) => {
        // Find the BEST Roboflow box for this class (highest confidence)
        const box = predictions
          .filter((p: any) => p.class === roboClass)
          .sort((a: any, b: any) => b.confidence - a.confidence)[0];

        if (box) {
          // Find text block INSIDE this box
          // We iterate through Google's blocks (skip 0)
          const matchingText = allText
            .slice(1)
            .find((textBlock: any) =>
              isInside(textBlock.boundingPoly, box, 0, 0)
            );

          if (matchingText) {
            // Clean the text: keep decimals
            const num = matchingText.description.match(/(\d+\.?\d*)/);
            if (num) updates[field] = num[0];
          }
        }
      });

      // Apply updates
      if (Object.keys(updates).length > 0 && activeMachineId) {
        setMachines((prev) =>
          prev.map((m) =>
            m.id === activeMachineId
              ? { ...m, data: { ...m.data, ...updates } }
              : m
          )
        );
        setDebugLog(`Mapped: ${JSON.stringify(updates)}`);
      } else {
        // Fallback: Display what we found if matching failed
        const classesFound = predictions.map((p: any) => p.class).join(", ");
        alert(
          `Model found boxes: [${classesFound}], but text did not overlap perfectly.\nTry getting closer.`
        );
      }
    } catch (e: any) {
      alert("Scan Error: " + e.message);
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanClick = (
    e: React.ChangeEvent<HTMLInputElement>,
    mappings: any[]
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () =>
        performHybridScan(reader.result as string, mappings);
      reader.readAsDataURL(file);
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

  const generateDoc = (machine: Machine) => {
    if (!templateFile) {
      alert("Upload Template first!");
      return;
    }
    const data = {
      inspector: "RH",
      "make model serial": machine.fullDetails,
      "registration number": machine.location,
      "registrant name": machine.registrantName,
      date: new Date().toLocaleDateString(),
      "tube number": machine.data["tube_num"] || "1",
      "preset kvp": machine.data["preset_kvp"] || "",
      "preset mas": machine.data["preset_mas"] || "",
      "preset time": machine.data["preset_time"] || "",
      details: machine.fullDetails,
      credential: machine.location,
      type: machine.type,
      ...machine.data,
    };
    createWordDoc(templateFile, data, `Inspection_${machine.location}.docx`);
    setMachines((prev) =>
      prev.map((m) => (m.id === machine.id ? { ...m, isComplete: true } : m))
    );
  };

  const clearAll = () => {
    if (window.confirm("Delete all?")) {
      setMachines([]);
      localStorage.removeItem("rs_machines");
    }
  };
  const activeMachine = machines.find((m) => m.id === activeMachineId);

  if (view === "settings")
    return (
      <div className="min-h-screen bg-slate-50 p-6 font-sans">
        <button onClick={() => setView("dashboard")} className="mb-6 font-bold">
          <ArrowLeft /> Back
        </button>
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
              Google Vision Key
            </label>
            <input
              className="w-full border p-3 rounded bg-white"
              type="password"
              value={googleKey}
              onChange={(e) => setGoogleKey(e.target.value)}
              placeholder="AIzaSy..."
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
              Roboflow API Key
            </label>
            <input
              className="w-full border p-3 rounded bg-white"
              type="password"
              value={roboflowKey}
              onChange={(e) => setRoboflowKey(e.target.value)}
              placeholder="rf_..."
            />
          </div>
          <button
            onClick={saveKeys}
            className="bg-blue-600 text-white px-4 py-2 rounded font-bold w-full"
          >
            Save Keys
          </button>

          <div className="border-2 border-dashed p-6 text-center rounded relative bg-white mt-6">
            <label className="block w-full h-full cursor-pointer">
              {templateName}
              <input
                type="file"
                accept=".docx"
                onChange={handleTemplateUpload}
                className="hidden"
              />
            </label>
            {templateFile && (
              <button
                onClick={clearTemplate}
                className="absolute top-2 right-2 p-1 bg-red-100 text-red-600 rounded-full"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    );

  if (view === "mobile-list")
    return (
      <div className="min-h-screen bg-slate-100 pb-20 font-sans">
        <header className="bg-blue-900 text-white p-4 flex justify-between">
          <h1 className="font-bold">My Inspections</h1>
          <button
            onClick={() => setView("dashboard")}
            className="text-xs bg-white/20 px-2 rounded"
          >
            Exit
          </button>
        </header>
        <div className="p-4 space-y-2">
          {machines.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setActiveMachineId(m.id);
                setView("mobile-form");
              }}
              className="bg-white p-4 rounded shadow flex justify-between items-center"
            >
              <div>
                <div className="font-bold text-lg text-blue-900">
                  {m.location}
                </div>
                <div className="text-xs text-slate-500">{m.fullDetails}</div>
              </div>
              <ChevronRight />
            </div>
          ))}
        </div>
      </div>
    );

  if (view === "mobile-form" && activeMachine) {
    return (
      <div className="min-h-screen bg-slate-50 pb-24 font-sans">
        <header className="bg-white p-4 border-b sticky top-0 z-10">
          <div className="flex gap-3 items-center mb-1">
            <button onClick={() => setView("mobile-list")}>
              <ArrowLeft />
            </button>
            <div className="font-bold text-lg">{activeMachine.location}</div>
          </div>
          <div className="text-xs text-slate-500 ml-9">
            {activeMachine.fullDetails}
          </div>
        </header>
        <div className="p-4 space-y-6">
          <div className="bg-blue-50 p-4 rounded border border-blue-100 shadow-sm">
            <h3 className="font-bold text-blue-800 text-sm mb-3 uppercase tracking-wide">
              Machine Settings
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Tube #
                </label>
                <input
                  className="w-full p-2 border rounded text-sm font-bold"
                  placeholder="1"
                  value={activeMachine.data["tube_num"] || ""}
                  onChange={(e) => updateField("tube_num", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Preset kVp
                </label>
                <input
                  className="w-full p-2 border rounded text-sm font-bold"
                  placeholder="70"
                  value={activeMachine.data["preset_kvp"] || ""}
                  onChange={(e) => updateField("preset_kvp", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Preset mAs
                </label>
                <input
                  className="w-full p-2 border rounded text-sm font-bold"
                  placeholder="10"
                  value={activeMachine.data["preset_mas"] || ""}
                  onChange={(e) => updateField("preset_mas", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Preset Time
                </label>
                <input
                  className="w-full p-2 border rounded text-sm font-bold"
                  placeholder="0.10"
                  value={activeMachine.data["preset_time"] || ""}
                  onChange={(e) => updateField("preset_time", e.target.value)}
                />
              </div>
            </div>
          </div>

          {debugLog && (
            <div className="bg-slate-900 text-green-400 p-2 text-[10px] font-mono overflow-x-auto whitespace-nowrap rounded mb-4">
              {debugLog}
            </div>
          )}

          {DENTAL_STEPS.map((step) => (
            <div
              key={step.id}
              className="bg-white p-4 rounded border shadow-sm"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-sm text-blue-900">
                    {step.label}
                  </div>
                  <div className="text-[10px] text-slate-400">{step.desc}</div>
                </div>
                <label className="bg-blue-600 text-white px-3 py-2 rounded text-xs font-bold cursor-pointer flex gap-1 items-center shadow-sm active:scale-95 transition-transform">
                  {isScanning ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ScanLine size={14} />
                  )}{" "}
                  Scan
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleScanClick(e, step.mappings)}
                    disabled={isScanning}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {step.mappings.map((m) => (
                  <div key={m.field}>
                    <label className="text-[9px] font-bold text-slate-400 uppercase">
                      {m.field} ({m.roboClass})
                    </label>
                    <div className="relative">
                      <input
                        value={activeMachine.data[m.field] || ""}
                        onChange={(e) => updateField(m.field, e.target.value)}
                        className="w-full font-mono text-lg border-b outline-none bg-transparent"
                        placeholder="-"
                      />
                      <Edit3 className="absolute right-0 top-1 text-slate-200 h-3 w-3 pointer-events-none" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="fixed bottom-0 w-full p-4 bg-white border-t">
          <button
            onClick={() => generateDoc(activeMachine)}
            className="w-full py-3 bg-emerald-600 text-white font-bold rounded shadow flex justify-center gap-2"
          >
            <Download /> Save Report
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans">
      <header className="flex justify-between mb-6">
        <div className="flex gap-2 items-center">
          <ScanLine className="text-blue-600" />
          <h1 className="text-xl font-bold">RayScan</h1>
        </div>
        <button onClick={() => setView("settings")}>
          <Settings />
        </button>
      </header>
      <div className="bg-white p-6 rounded shadow text-center mb-4">
        <div className="text-4xl font-bold text-blue-600 mb-4">
          {machines.length}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="bg-slate-100 p-3 rounded cursor-pointer font-bold text-sm">
            Import Excel
            <input
              type="file"
              accept=".xlsx"
              onChange={handleExcelUpload}
              className="hidden"
            />
          </label>
          <button
            onClick={() => setView("mobile-list")}
            className="bg-blue-600 text-white p-3 rounded font-bold text-sm"
          >
            Start Scan
          </button>
        </div>
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <div className="p-3 bg-slate-50 border-b flex justify-between font-bold text-xs uppercase">
          <span>Machines</span>
          <button onClick={clearAll}>
            <Trash2 size={14} className="text-red-500" />
          </button>
        </div>
        {machines.map((m) => (
          <div
            key={m.id}
            className="p-3 border-b flex justify-between items-center"
          >
            <div>
              <div className="font-bold text-sm">{m.location}</div>
              <div className="text-xs text-slate-500">{m.fullDetails}</div>
            </div>
            {m.isComplete && (
              <CheckCircle className="text-emerald-500" size={16} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

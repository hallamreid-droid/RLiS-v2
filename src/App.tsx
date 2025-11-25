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
} from "lucide-react";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";

// --- TYPES ---
type Machine = {
  id: string;
  make: string;
  model: string;
  serial: string;
  type: string;
  location: string;
  data: { [key: string]: string };
  isComplete: boolean;
};

export default function RayScanLocal() {
  const [view, setView] = useState<
    "dashboard" | "mobile-list" | "mobile-form" | "settings"
  >("dashboard");
  const [apiKey, setApiKey] = useState("");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);

  // Template is kept in memory
  const [templateFile, setTemplateFile] = useState<ArrayBuffer | null>(null);
  const [templateName, setTemplateName] =
    useState<string>("No Template Loaded");

  const [isScanning, setIsScanning] = useState(false);

  // --- PERSISTENCE ---
  useEffect(() => {
    const savedKey = localStorage.getItem("rayScanApiKey");
    const savedMachines = localStorage.getItem("rayScanMachines");
    if (savedKey) setApiKey(savedKey);
    if (savedMachines) setMachines(JSON.parse(savedMachines));
  }, []);

  useEffect(() => {
    localStorage.setItem("rayScanMachines", JSON.stringify(machines));
  }, [machines]);

  // --- ACTIONS ---

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    localStorage.setItem("rayScanApiKey", e.target.value);
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

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: "binary" });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);

      const newMachines: Machine[] = data.map((row: any, index: number) => ({
        id: `mach_${Date.now()}_${index}`,
        make: row["Make"] || row["Manufacturer"] || "Unknown",
        model: row["Model"] || "Unknown",
        serial: row["Serial"] || row["Serial Number"] || "N/A",
        type: row["Type"] || "Radiographic",
        location: row["Location"] || `Room ${index + 1}`,
        data: {},
        isComplete: false,
      }));

      setMachines(newMachines);
      alert(`Loaded ${newMachines.length} machines. Ready to inspect.`);
    };
    reader.readAsBinaryString(file);
  };

  const performOCR = async (base64Image: string, field: string) => {
    if (!apiKey) {
      alert("Please set API Key in Settings first!");
      return;
    }
    setIsScanning(true);

    try {
      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                image: { content: base64Image.split(",")[1] },
                features: [{ type: "TEXT_DETECTION" }],
              },
            ],
          }),
        }
      );
      const data = await response.json();
      const text = data.responses[0]?.fullTextAnnotation?.text || "";

      let value = "";
      if (field === "kvp")
        value = text.match(/(\d+\.?\d*)\s*(kV|kVp)/i)?.[1] || "";
      else if (field === "time")
        value = text.match(/(\d+\.?\d*)\s*(ms|s)/i)?.[1] || "";
      else if (field === "dose")
        value = text.match(/(\d+\.?\d*)\s*(mGy|mR|R)/i)?.[1] || "";
      else if (field === "hvl")
        value = text.match(/(\d+\.?\d*)\s*(mm)/i)?.[1] || "";
      else value = text.match(/(\d+\.?\d*)/)?.[1] || "";

      if (value) {
        updateMachineData(field, value);
      } else {
        alert(`Could not find value in text: \n"${text}"\nTry getting closer.`);
      }
    } catch (e) {
      alert("OCR Error. Check internet or API Key.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleCameraInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: string
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => performOCR(reader.result as string, field);
      reader.readAsDataURL(file);
    }
  };

  const updateMachineData = (field: string, value: string) => {
    if (!activeMachineId) return;
    setMachines((prev) =>
      prev.map((m) =>
        m.id === activeMachineId
          ? {
              ...m,
              data: { ...m.data, [field]: value },
            }
          : m
      )
    );
  };

  const generateDoc = (machine: Machine) => {
    if (!templateFile) {
      alert("Please upload Template in Settings!");
      return;
    }

    try {
      const zip = new PizZip(templateFile);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
      });

      doc.render({
        make: machine.make,
        model: machine.model,
        serial: machine.serial,
        location: machine.location,
        type: machine.type,
        kvp: machine.data["kvp"] || "---",
        time: machine.data["time"] || "---",
        dose: machine.data["dose"] || "---",
        hvl: machine.data["hvl"] || "---",
      });

      const out = doc
        .getZip()
        .generate({
          type: "blob",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      saveAs(out, `Inspection_${machine.serial}.docx`);
      setMachines((prev) =>
        prev.map((m) => (m.id === machine.id ? { ...m, isComplete: true } : m))
      );
    } catch (e) {
      console.error(e);
      alert("Error creating doc. Check template tags {kvp}, etc.");
    }
  };

  const clearAll = () => {
    if (confirm("Delete all machines?")) {
      setMachines([]);
      localStorage.removeItem("rayScanMachines");
    }
  };

  const activeMachine = machines.find((m) => m.id === activeMachineId);

  // VIEW ROUTER
  if (view === "settings") {
    return (
      <div className="min-h-screen bg-slate-50 p-6 font-sans">
        <button
          onClick={() => setView("dashboard")}
          className="flex items-center gap-2 mb-6 font-bold text-slate-600"
        >
          <ArrowLeft /> Back
        </button>
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <div className="bg-white p-6 rounded-xl shadow-sm border mb-4">
          <label className="block font-bold mb-2 text-sm text-slate-700">
            Google Vision API Key
          </label>
          <input
            value={apiKey}
            onChange={handleApiKeyChange}
            type="password"
            placeholder="AIzaSy..."
            className="w-full border p-3 rounded-lg font-mono text-sm outline-none"
          />
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border">
          <label className="block font-bold mb-2 text-sm text-slate-700">
            Word Document Template
          </label>
          <div
            className={`border-2 border-dashed p-6 rounded-xl text-center ${
              templateFile
                ? "border-emerald-400 bg-emerald-50"
                : "border-slate-300"
            }`}
          >
            {templateFile ? (
              <div className="text-emerald-700 font-bold">
                <CheckCircle className="mx-auto mb-2" />
                {templateName}
              </div>
            ) : (
              <div className="text-slate-400">
                <UploadCloud className="mx-auto mb-2" />
                <span className="text-sm">Upload .docx Template</span>
              </div>
            )}
            <input
              type="file"
              accept=".docx"
              onChange={handleTemplateUpload}
              className="hidden"
              id="tmpl-upload"
            />
            <label
              htmlFor="tmpl-upload"
              className="absolute inset-0 cursor-pointer"
            ></label>
          </div>
        </div>
      </div>
    );
  }

  if (view === "mobile-list") {
    return (
      <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-20">
        <header className="bg-blue-900 text-white p-4 pt-6 sticky top-0 z-10 shadow-md flex justify-between items-center">
          <h1 className="text-lg font-bold">My Inspections</h1>
          <button
            onClick={() => setView("dashboard")}
            className="text-xs bg-white/20 px-3 py-1 rounded"
          >
            Exit
          </button>
        </header>
        <div className="p-4 space-y-3">
          {machines.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setActiveMachineId(m.id);
                setView("mobile-form");
              }}
              className={`bg-white p-4 rounded-xl shadow-sm flex justify-between items-center cursor-pointer active:scale-95 transition-transform border ${
                m.isComplete ? "border-emerald-500" : "border-slate-200"
              }`}
            >
              <div>
                <div className="font-bold text-slate-800">{m.location}</div>
                <div className="text-xs text-slate-500">
                  {m.make} • {m.type}
                </div>
              </div>
              <ChevronRight className="text-slate-300" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (view === "mobile-form" && activeMachine) {
    const fields = ["kvp", "time", "dose", "hvl"];
    return (
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-24">
        <header className="bg-white p-4 border-b sticky top-0 flex items-center gap-3 z-10 shadow-sm">
          <button
            onClick={() => setView("mobile-list")}
            className="p-2 bg-slate-100 rounded-full"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="font-bold leading-tight">
              {activeMachine.make} {activeMachine.model}
            </div>
            <div className="text-xs text-slate-500">{activeMachine.serial}</div>
          </div>
        </header>
        <div className="p-4 space-y-4">
          {fields.map((field) => (
            <div
              key={field}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm"
            >
              <div className="flex justify-between mb-2">
                <span className="text-xs font-bold uppercase text-slate-500">
                  {field}
                </span>
                <label
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-all ${
                    isScanning
                      ? "bg-slate-100 text-slate-400"
                      : "bg-blue-600 text-white shadow-md active:scale-95"
                  }`}
                >
                  {isScanning ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Camera size={12} />
                  )}
                  {isScanning ? "Scanning..." : "Scan"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleCameraInput(e, field)}
                    disabled={isScanning}
                  />
                </label>
              </div>
              <input
                value={activeMachine.data[field] || ""}
                onChange={(e) => updateMachineData(field, e.target.value)}
                placeholder="-"
                className="w-full text-3xl font-mono font-bold text-slate-800 border-b border-slate-200 focus:border-blue-500 outline-none bg-transparent py-1"
              />
            </div>
          ))}
        </div>
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t flex gap-3">
          <button
            onClick={() => generateDoc(activeMachine)}
            className="flex-1 py-4 bg-emerald-600 text-white font-bold rounded-xl shadow-lg flex justify-center gap-2 active:scale-95 transition-transform"
          >
            <Download /> Save & Download
          </button>
        </div>
      </div>
    );
  }

  // DASHBOARD DEFAULT
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-4 max-w-lg mx-auto">
      <header className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <ScanLine className="h-8 w-8 text-blue-600" />
          <h1 className="text-xl font-bold">RayScan Local</h1>
        </div>
        <button
          onClick={() => setView("settings")}
          className="p-2 bg-slate-200 rounded-full"
        >
          <Settings size={20} />
        </button>
      </header>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-6 text-center">
        <div className="text-4xl font-bold text-blue-600 mb-1">
          {machines.length}
        </div>
        <div className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-4">
          Machines Loaded
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="bg-slate-100 text-slate-700 py-3 rounded-lg font-bold text-sm cursor-pointer hover:bg-slate-200">
            <div className="flex justify-center mb-1">
              <FileSpreadsheet size={18} />
            </div>
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
            disabled={machines.length === 0}
            className="bg-blue-600 text-white py-3 rounded-lg font-bold text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <div className="flex justify-center mb-1">
              <Camera size={18} />
            </div>
            Start Scan
          </button>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 p-3 border-b border-slate-100 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-500 uppercase">
            Machine List
          </span>
          {machines.length > 0 && (
            <button onClick={clearAll} className="text-red-500">
              <Trash2 size={16} />
            </button>
          )}
        </div>
        {machines.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">
            No data. Import Excel.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {machines.map((m) => (
              <div
                key={m.id}
                className="p-3 border-b flex justify-between items-center"
              >
                <div>
                  <div className="font-bold text-sm">
                    {m.make} {m.model}
                  </div>
                  <div className="text-xs text-slate-500">{m.serial}</div>
                </div>
                {m.isComplete && (
                  <CheckCircle size={16} className="text-emerald-500" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

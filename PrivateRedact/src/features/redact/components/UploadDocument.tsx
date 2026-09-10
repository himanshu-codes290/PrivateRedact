import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  FileText,
  X,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Trash2,
  Lock,
} from "lucide-react";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB Limit

export interface UploadedFileItem {
  id: string;
  file: File;
  name: string;
  size: string;
  progress: number;
  status: "ready" | "uploading" | "error";
}

interface DocumentUploadProps {
  onProceedToRedact?: (files: UploadedFileItem[]) => void;
}

export default function DocumentUpload({ onProceedToRedact }: DocumentUploadProps) {
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[], fileRejections: any[]) => {
    setErrorMessage(null);

    if (fileRejections.length > 0) {
      const isOversized = fileRejections.some((r) => r.file.size > MAX_FILE_SIZE);
      if (isOversized) {
        setErrorMessage("One or more files exceed the maximum limit of 25MB.");
      } else {
        setErrorMessage("Invalid file type. Please upload valid PDF documents.");
      }
    }

    const newFiles: UploadedFileItem[] = acceptedFiles.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(2),
      progress: 100,
      status: "ready",
    }));

    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxSize: MAX_FILE_SIZE,
    multiple: true,
  });

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleProceed = () => {
    if (files.length === 0) return;
    if (onProceedToRedact) {
      onProceedToRedact(files);
    }
  };

  return (
    <div className="min-h-[calc(100vh-65px)] bg-[#06060f] relative overflow-hidden">

      {/* Background blobs */}
      <div className="absolute inset-0 dot-grid pointer-events-none opacity-50" />
      <div className="absolute top-1/4 left-[10%] w-[500px] h-[500px] rounded-full bg-violet-700/15 blur-[120px] animate-pulse-blob pointer-events-none" />
      <div className="absolute bottom-1/4 right-[5%] w-[400px] h-[400px] rounded-full bg-purple-700/10 blur-[100px] animate-pulse-blob anim-delay-2000 pointer-events-none" />

      <div className="relative max-w-3xl mx-auto px-6 py-16">

        {/* Page header */}
        <div className="text-center mb-10 animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-5">
            <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse inline-block" />
            Secure Document Redaction
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white mb-3">
            Upload Your <span className="shimmer-text">Documents</span>
          </h1>
          <p className="text-gray-400 text-[15px] leading-relaxed max-w-md mx-auto">
            Select single or batch PDFs. All processing happens locally — your files never leave your device.
          </p>
        </div>

        {/* Main card */}
        <div
          className="relative rounded-2xl border border-white/[0.08] bg-[#0d0d1f]/80 backdrop-blur-xl shadow-2xl animate-fade-in-up anim-delay-200"
          style={{ boxShadow: "0 0 60px rgba(124,58,237,0.08), 0 25px 50px rgba(0,0,0,0.5)" }}
        >
          {/* Card header */}
          <div className="px-8 pt-8 pb-6 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
                <Upload className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-white">Upload PDF Documents</h2>
                <p className="text-xs text-gray-500 mt-0.5">Supports batch upload · Up to 25 MB per file</p>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-6">

            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-300 group ${
                isDragActive
                  ? "border-violet-500/70 bg-violet-500/5 scale-[1.01]"
                  : "border-white/[0.1] hover:border-violet-500/40 hover:bg-violet-500/[0.03] bg-white/[0.01]"
              }`}
            >
              <input {...getInputProps()} />

              {/* Glow on drag */}
              {isDragActive && (
                <div className="absolute inset-0 rounded-xl bg-violet-500/5 animate-pulse pointer-events-none" />
              )}

              <div className="flex flex-col items-center justify-center space-y-4">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                  isDragActive
                    ? "bg-violet-500/20 text-violet-400 scale-110"
                    : "bg-white/[0.04] text-gray-500 group-hover:bg-violet-500/10 group-hover:text-violet-400"
                }`}>
                  <Upload className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[15px] font-semibold text-white">
                    {isDragActive ? "Drop your PDFs here…" : "Drag & drop PDF files, or click to browse"}
                  </p>
                  <p className="text-xs text-gray-600">
                    Batch upload supported · Max 25 MB per document
                  </p>
                </div>
                {!isDragActive && (
                  <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium">
                    Browse Files
                  </div>
                )}
              </div>
            </div>

            {/* Error alert */}
            {errorMessage && (
              <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/25 bg-red-500/5">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-400">Upload Error</p>
                  <p className="text-xs text-red-400/70 mt-0.5">{errorMessage}</p>
                </div>
                <button
                  onClick={() => setErrorMessage(null)}
                  className="ml-auto text-red-400/50 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* File queue */}
            {files.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    Queued Documents
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold">
                      {files.length}
                    </span>
                  </h3>
                  <button
                    onClick={() => setFiles([])}
                    className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear All
                  </button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
                  {files.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors group/item"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-violet-400" />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-medium text-white truncate">{item.name}</p>
                          <p className="text-[11px] text-gray-600">{item.size} MB</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/8 text-emerald-400 text-[10px] font-semibold">
                          <CheckCircle className="w-3 h-3" />
                          Ready
                        </div>
                        <button
                          onClick={() => removeFile(item.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-700 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover/item:opacity-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Card footer */}
          <div className="px-8 py-5 border-t border-white/[0.06] flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
              <Lock className="w-3.5 h-3.5 text-emerald-500/70" />
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>100% offline · AES-256 encrypted</span>
            </div>

            <button
              disabled={files.length === 0}
              onClick={handleProceed}
              className={`group flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
                files.length === 0
                  ? "bg-white/[0.04] text-gray-600 cursor-not-allowed"
                  : "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-[1.02]"
              }`}
            >
              Open Redaction Workspace
              <ArrowRight className={`w-4 h-4 transition-transform duration-200 ${files.length > 0 ? "group-hover:translate-x-1" : ""}`} />
            </button>
          </div>
        </div>

        {/* Trust pills below card */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-xs text-gray-600 animate-fade-in-up anim-delay-400">
          {[
            { icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />, label: "No data ever leaves your device" },
            { icon: <Lock className="w-3.5 h-3.5 text-violet-400" />, label: "HIPAA & GDPR compliant" },
            { icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />, label: "No signup required" },
          ].map(({ icon, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              {icon}
              {label}
            </span>
          ))}
        </div>

      </div>
    </div>
  );
}
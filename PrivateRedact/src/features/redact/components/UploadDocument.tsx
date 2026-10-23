import { useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import {
  AlertCircle,
  ArrowRight,
  CircleCheck,
  FileText,
  Loader2,
  Lock,
  ShieldCheck,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  formatBytes,
  intakeFiles,
  type QueuedFile,
} from '@/features/redact/lib/fileIntake';

interface UploadDocumentProps {
  /** Files already queued (when returning from the workspace). */
  initialFiles?: readonly QueuedFile[];
  onProceed: (files: QueuedFile[]) => void;
}

function rejectionMessage(r: FileRejection): string {
  const code = r.errors[0]?.code;
  if (code === 'file-too-large')
    return `${r.file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`;
  if (code === 'file-invalid-type') return `${r.file.name} is not a PDF.`;
  if (code === 'too-many-files') return `Only ${MAX_FILES} files can be queued at once.`;
  return `${r.file.name} could not be added.`;
}

/** Step 1: choose the PDFs to redact. Nothing is uploaded anywhere. */
export default function UploadDocument({ initialFiles = [], onProceed }: UploadDocumentProps) {
  const [files, setFiles] = useState<QueuedFile[]>([...initialFiles]);
  const [errors, setErrors] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);

  const onDrop = async (accepted: File[], rejections: FileRejection[]) => {
    setChecking(true);
    try {
      const result = await intakeFiles(accepted, files);
      setFiles((prev) => [...prev, ...result.accepted]);
      setErrors([...rejections.map(rejectionMessage), ...result.errors]);
    } finally {
      setChecking(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (a, r) => void onDrop(a, r),
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: MAX_FILE_BYTES,
    multiple: true,
  });

  const encryptedCount = files.filter((f) => f.encrypted).length;

  return (
    <div className="relative min-h-[calc(100vh-var(--nav-h))] overflow-hidden bg-[#06060f]">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="pointer-events-none absolute left-[10%] top-1/4 h-[500px] w-[500px] rounded-full bg-violet-700/15 blur-[120px] animate-pulse-blob" />

      <div className="relative mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-10 text-center animate-fade-in-up">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-300">
            <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            Runs entirely in your browser
          </div>
          <h1 className="mb-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
            Choose your <span className="shimmer-text">documents</span>
          </h1>
          <p className="mx-auto max-w-md text-[15px] leading-relaxed text-gray-400">
            Add one PDF or a batch. Files are opened locally and are never sent to a server.
          </p>
        </div>

        <section
          className="relative rounded-2xl border border-white/[0.08] bg-[#0d0d1f]/80 shadow-2xl backdrop-blur-xl animate-fade-in-up anim-delay-200"
          aria-labelledby="upload-title"
        >
          <div className="border-b border-white/[0.06] px-6 pb-6 pt-7 sm:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15">
                <Upload className="h-5 w-5 text-violet-400" aria-hidden="true" />
              </div>
              <div>
                <h2 id="upload-title" className="text-[15px] font-bold text-white">
                  PDF documents
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  Up to {MAX_FILES} files · {formatBytes(MAX_FILE_BYTES)} each
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-6 sm:p-8">
            <div
              {...getRootProps()}
              className={`relative cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${
                isDragActive
                  ? 'scale-[1.01] border-violet-500/70 bg-violet-500/5'
                  : 'border-white/[0.1] bg-white/[0.01] hover:border-violet-500/40 hover:bg-violet-500/[0.03]'
              }`}
            >
              <input {...getInputProps()} aria-label="Choose PDF files" />
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04] text-gray-400">
                  {checking ? (
                    <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="h-7 w-7" aria-hidden="true" />
                  )}
                </div>
                <p className="text-[15px] font-semibold text-white">
                  {isDragActive ? 'Drop your PDFs here…' : 'Drag & drop PDFs, or click to browse'}
                </p>
                <p className="text-xs text-gray-500">
                  Each file is checked to be a real PDF before it is added.
                </p>
              </div>
            </div>

            {errors.length > 0 && (
              <div
                className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/5 p-4"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                <ul className="flex-1 space-y-0.5 text-xs text-red-300/90">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  aria-label="Dismiss errors"
                  onClick={() => setErrors([])}
                  className="text-red-400/60 transition-colors hover:text-red-300"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {files.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    Queue
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500/20 px-1.5 text-[10px] font-bold text-violet-300">
                      {files.length}
                    </span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Clear all
                  </button>
                </div>

                <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {files.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                          <FileText className="h-4 w-4 text-violet-400" aria-hidden="true" />
                        </div>
                        <div className="truncate">
                          <p className="truncate text-sm font-medium text-white">{item.name}</p>
                          <p className="text-[11px] text-gray-500">{formatBytes(item.size)}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {item.encrypted ? (
                          <span className="flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            Encrypted
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400">
                            <CircleCheck className="h-3 w-3" aria-hidden="true" />
                            Ready
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setFiles((prev) => prev.filter((f) => f.id !== item.id))}
                          aria-label={`Remove ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {encryptedCount > 0 && (
                  <p className="text-[11.5px] text-amber-300/80">
                    Encrypted PDFs can be viewed but not redacted. Remove their protection first.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse items-stretch justify-between gap-4 border-t border-white/[0.06] px-6 py-5 sm:flex-row sm:items-center sm:px-8">
            <p className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              No upload · no account · works offline
            </p>
            <button
              type="button"
              disabled={files.length === 0 || checking}
              onClick={() => onProceed(files)}
              className="group flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:from-violet-500 hover:to-purple-500 disabled:cursor-not-allowed disabled:from-white/[0.04] disabled:to-white/[0.04] disabled:text-gray-600 disabled:shadow-none"
            >
              Open workspace
              <ArrowRight
                className="h-4 w-4 transition-transform group-enabled:group-hover:translate-x-1"
                aria-hidden="true"
              />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

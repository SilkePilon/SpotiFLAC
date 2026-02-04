import { useEffect, useState } from "react";
import { X, Download, CheckCircle2, XCircle, Clock, FileCheck, Trash2, HardDrive, Zap, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GetDownloadQueue, ClearCompletedDownloads, ClearAllDownloads } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { backend } from "../../wailsjs/go/models";

const TidalIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={`inline-block w-4 h-4 fill-current ${className || ""}`}>
        <path d="M4.022 4.5 0 8.516l3.997 3.99 3.997-3.984L4.022 4.5Zm7.956 0L7.994 8.522l4.003 3.984L16 8.484 11.978 4.5Zm8.007 0L24 8.528l-4.003 3.978L16 8.484 19.985 4.5Z"></path>
        <path d="m8.012 16.534 3.991 3.966L16 16.49l-4.003-3.984-3.985 4.028Z"></path>
    </svg>
);

const QobuzIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={`inline-block w-4 h-4 fill-current ${className || ""}`}>
        <path d="M21.744 9.815C19.836 1.261 8.393-1 3.55 6.64-.618 13.214 4 22 11.988 22c2.387 0 4.63-.83 6.394-2.304l2.252 2.252 1.224-1.224-2.252-2.253c1.983-2.407 2.823-5.586 2.138-8.656Zm-3.508 7.297L16.4 15.275c-.786-.787-2.017.432-1.224 1.225L17 18.326C10.29 23.656.5 16 5.16 7.667c3.502-6.264 13.172-4.348 14.707 2.574.529 2.385-.06 4.987-1.63 6.87Z"></path>
        <path d="M13.4 8.684a3.59 3.59 0 0 0-4.712 1.9 3.59 3.59 0 0 0 1.9 4.712 3.594 3.594 0 0 0 4.711-1.89 3.598 3.598 0 0 0-1.9-4.722Zm-.737 3.591a.727.727 0 0 1-.965.384.727.727 0 0 1-.384-.965.727.727 0 0 1 .965-.384.73.73 0 0 1 .384.965Z"></path>
    </svg>
);

const AmazonIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={`inline-block w-4 h-4 fill-current ${className || ""}`}>
        <path fillRule="evenodd" d="M15.62 11.13c-.15.1-.37.18-.64.18-.42 0-.82-.05-1.21-.18l-.22-.04c-.08 0-.1.04-.1.14v.25c0 .08.02.12.05.17.02.03.07.08.15.1.4.18.84.25 1.33.25.52 0 .91-.12 1.24-.37.32-.25.47-.57.47-.99 0-.3-.08-.52-.23-.72-.15-.17-.4-.34-.74-.47l-.7-.27c-.26-.1-.46-.2-.53-.3a.47.47 0 0 1-.15-.36c0-.38.27-.57.84-.57.32 0 .64.05.94.15l.2.04c.07 0 .12-.04.12-.14v-.25c0-.08-.03-.12-.05-.17a.54.54 0 0 0-.12-.1c-.32-.07-.64-.15-.94-.15-.7 0-1.21.2-1.6.62-.38.4-.57 1-.57 1.73 0 .74.17 1.31.54 1.7.37.4.89.6 1.58.6.37 0 .72-.05.99-.17.07-.03.12-.05.15-.1.02-.03.02-.1.02-.17v-.25c0-.13-.05-.17-.12-.17-.03 0-.07 0-.12.02-.28.07-.55.12-.8.12-.46 0-.81-.12-1.03-.37-.23-.24-.32-.64-.32-1.16v-.12c.02-.55.12-.94.34-1.19Z" clipRule="evenodd"></path>
        <path fillRule="evenodd" d="M21.55 17.46c1.29-1.09 1.64-3.33 1.36-3.68-.12-.15-.71-.3-1.45-.3-.8 0-1.73.18-2.45.67-.22.15-.17.35.05.32.76-.1 2.5-.3 2.82.1.3.4-.35 2.03-.65 2.74-.07.23.1.3.32.15ZM18.12 7.4h-.52c-.12 0-.17.05-.17.18v4.1c0 .12.05.17.17.17h.52c.12 0 .17-.05.17-.17v-4.1c0-.1-.05-.18-.17-.18Zm.15-1.68a.58.58 0 0 0-.42-.15c-.18 0-.3.05-.4.15a.5.5 0 0 0-.15.37c0 .15.05.3.15.37.1.1.22.15.4.15.17 0 .3-.05.4-.15a.5.5 0 0 0 .14-.37c0-.15-.02-.3-.12-.37Z" clipRule="evenodd"></path>
    </svg>
);

const getSourceIcon = (source: string) => {
    switch (source?.toLowerCase()) {
        case "tidal":
            return <TidalIcon className="text-[#00FFFF]" />;
        case "qobuz":
            return <QobuzIcon className="text-[#4A90D9]" />;
        case "amazon":
            return <AmazonIcon className="text-[#FF9900]" />;
        default:
            return null;
    }
};

const getSourceName = (source: string) => {
    switch (source?.toLowerCase()) {
        case "tidal":
            return "Tidal";
        case "qobuz":
            return "Qobuz";
        case "amazon":
            return "Amazon Music";
        default:
            return source || "Unknown";
    }
};
interface DownloadQueueProps {
    isOpen: boolean;
    onClose: () => void;
}
export function DownloadQueue({ isOpen, onClose }: DownloadQueueProps) {
    const [queueInfo, setQueueInfo] = useState<backend.DownloadQueueInfo>(new backend.DownloadQueueInfo({
        is_downloading: false,
        queue: [],
        current_speed: 0,
        total_downloaded: 0,
        session_start_time: 0,
        queued_count: 0,
        completed_count: 0,
        failed_count: 0,
        skipped_count: 0,
    }));
    useEffect(() => {
        if (!isOpen)
            return;
        const fetchQueue = async () => {
            try {
                const info = await GetDownloadQueue();
                setQueueInfo(info);
            }
            catch (error) {
                console.error("Failed to get download queue:", error);
            }
        };
        fetchQueue();
        const interval = setInterval(fetchQueue, 500);
        return () => clearInterval(interval);
    }, [isOpen]);
    const handleClearHistory = async () => {
        try {
            await ClearCompletedDownloads();
            const info = await GetDownloadQueue();
            setQueueInfo(info);
        }
        catch (error) {
            console.error("Failed to clear history:", error);
        }
    };
    const handleReset = async () => {
        try {
            await ClearAllDownloads();
            const info = await GetDownloadQueue();
            setQueueInfo(info);
            toast.success("Download queue reset");
        }
        catch (error) {
            console.error("Failed to reset queue:", error);
        }
    };
    const getStatusIcon = (status: string) => {
        switch (status) {
            case "downloading":
                return <Download className="h-4 w-4 text-blue-500 animate-bounce"/>;
            case "completed":
                return <CheckCircle2 className="h-4 w-4 text-green-500"/>;
            case "failed":
                return <XCircle className="h-4 w-4 text-red-500"/>;
            case "skipped":
                return <FileCheck className="h-4 w-4 text-yellow-500"/>;
            case "queued":
                return <Clock className="h-4 w-4 text-muted-foreground"/>;
            default:
                return null;
        }
    };
    const getStatusBadge = (status: string) => {
        const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
            downloading: "default",
            completed: "outline",
            failed: "destructive",
            skipped: "secondary",
            queued: "outline",
        };
        return (<Badge variant={variants[status] || "outline"} className="text-xs">
      {status}
    </Badge>);
    };
    const formatDuration = (startTimestamp: number) => {
        if (startTimestamp === 0)
            return "—";
        const now = Math.floor(Date.now() / 1000);
        const durationSeconds = now - startTimestamp;
        const hours = Math.floor(durationSeconds / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);
        const seconds = durationSeconds % 60;
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        }
        else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        else {
            return `${seconds}s`;
        }
    };
    return (<Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="max-w-[1200px] w-[95vw] max-h-[80vh] flex flex-col p-0 gap-0 [&>button]:hidden">
      <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-0">
        <div className="flex items-center justify-between mb-4">
          <DialogTitle className="text-lg font-semibold hover:text-primary transition-colors cursor-pointer" onClick={handleReset}>Download Queue</DialogTitle>
          <div className="flex items-center gap-2">
            {(queueInfo.completed_count > 0 || queueInfo.failed_count > 0 || queueInfo.skipped_count > 0) && (<Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={handleClearHistory}>
              <Trash2 className="h-3 w-3"/>
              Clear History
            </Button>)}
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full hover:bg-muted" onClick={onClose}>
              <X className="h-4 w-4"/>
            </Button>
          </div>
        </div>


        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground"/>
            <span className="text-muted-foreground">Queued:</span>
            <span className="font-semibold">{queueInfo.queued_count}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500"/>
            <span className="text-muted-foreground">Completed:</span>
            <span className="font-semibold">{queueInfo.completed_count}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <FileCheck className="h-3.5 w-3.5 text-yellow-500"/>
            <span className="text-muted-foreground">Skipped:</span>
            <span className="font-semibold">{queueInfo.skipped_count}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-red-500"/>
            <span className="text-muted-foreground">Failed:</span>
            <span className="font-semibold">{queueInfo.failed_count}</span>
          </div>
        </div>


        <div className="flex items-center gap-4 text-sm pt-3 mt-3 border-t">
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5 text-muted-foreground"/>
            <span className="text-muted-foreground">Downloaded:</span>
            <span className="font-semibold font-mono">
              {queueInfo.total_downloaded > 0 ? `${queueInfo.total_downloaded.toFixed(2)} MB` : "0.00 MB"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-muted-foreground"/>
            <span className="text-muted-foreground">Speed:</span>
            <span className="font-semibold font-mono">
              {queueInfo.current_speed > 0 && queueInfo.is_downloading
            ? `${queueInfo.current_speed.toFixed(2)} MB/s`
            : "—"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5 text-muted-foreground"/>
            <span className="text-muted-foreground">Duration:</span>
            <span className="font-semibold font-mono">
              {queueInfo.session_start_time > 0 ? formatDuration(queueInfo.session_start_time) : "—"}
            </span>
          </div>
        </div>

      </DialogHeader>


      <div className="flex-1 overflow-y-auto px-6 custom-scrollbar">
        <div className="space-y-2 py-4">
          {queueInfo.queue.length === 0 ? (<div className="text-center py-12 text-muted-foreground">
            <Download className="h-12 w-12 mx-auto mb-3 opacity-20"/>
            <p>No downloads in queue</p>
          </div>) : (queueInfo.queue.map((item) => (<div key={item.id} className="border rounded-lg p-3 hover:bg-muted/30 transition-colors">
            <div className="flex items-start gap-3">
              <div className="mt-1">{getStatusIcon(item.status)}</div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{item.track_name}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {item.artist_name}
                      {item.album_name && ` • ${item.album_name}`}
                    </p>
                  </div>
                  {getStatusBadge(item.status)}
                </div>


                {item.status === "downloading" && (<div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground font-mono">
                  <span>
                    {item.progress > 0
                    ? `${item.progress.toFixed(2)} MB`
                    : queueInfo.is_downloading && queueInfo.current_speed > 0
                        ? "Downloading..."
                        : "Starting..."}
                  </span>
                  <span>
                    {item.speed > 0
                    ? `${item.speed.toFixed(2)} MB/s`
                    : queueInfo.current_speed > 0
                        ? `${queueInfo.current_speed.toFixed(2)} MB/s`
                        : "—"}
                  </span>
                </div>)}


                {item.status === "completed" && (<div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span className="font-mono">{item.progress.toFixed(2)} MB</span>
                  {item.source && (
                    <TooltipProvider>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1">
                            {getSourceIcon(item.source)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{getSourceName(item.source)}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>)}


                {item.status === "skipped" && (<div className="mt-1.5 text-xs text-muted-foreground">
                  File already exists
                </div>)}


                {item.status === "failed" && item.error_message && (<div className="mt-1.5 text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded px-2 py-1">
                  {item.error_message}
                </div>)}


                {(item.status === "completed" || item.status === "skipped") && item.file_path && (<div className="mt-1.5 text-xs text-muted-foreground truncate font-mono">
                  {item.file_path}
                </div>)}
              </div>
            </div>
          </div>)))}
        </div>
      </div>
    </DialogContent>
  </Dialog>);
}

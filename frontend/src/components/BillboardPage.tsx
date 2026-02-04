import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FolderOpen, Loader2, StopCircle, Play, RotateCcw } from "lucide-react";
import { FetchBillboardHot100, GetCurrentBillboardDate, SearchSpotify, OpenFolder, LoadSettings } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { useDownload } from "@/hooks/useDownload";
import { TrackList } from "@/components/TrackList";
import { SearchAndSort } from "@/components/SearchAndSort";
import { DownloadProgress } from "@/components/DownloadProgress";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { getSettings } from "@/lib/settings";
import type { TrackMetadata } from "@/types/api";

// Billboard Hot 100 logo (uses the "B" icon)
const BillboardLogo = () => (
    <div className="w-48 h-48 rounded-md shadow-lg bg-gradient-to-br from-yellow-400 via-red-500 to-pink-500 flex items-center justify-center p-6">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90" className="w-full h-full fill-white">
            <path d="M34.995 31.265V8H18v73.284h16.693v-4.819C38.717 80.257 43.039 82 48.37 82 61.341 82 72 70.316 72 55.15c0-16.094-11.058-27.265-25.238-27.265-4.626 0-8.449 1.027-11.767 3.38Zm.102 23.918c0-5.544 4.413-10.042 9.856-10.042 5.44 0 9.853 4.498 9.853 10.042 0 5.549-4.413 10.047-9.853 10.047-5.443 0-9.856-4.498-9.856-10.047Z" fillRule="nonzero"/>
        </svg>
    </div>
);

interface BillboardEntry {
    rank: number;
    title: string;
    artist: string;
}

interface CachedBillboardData {
    date: string;
    chartDate: string;
    entries: BillboardEntry[];
    tracks: TrackMetadata[];
    matchedIndices: number[];
    timestamp: number;
}

interface BillboardPageProps {
    region: string;
    billboardDate: string;
    onBillboardDateChange: (date: string) => void;
}

// Cache key prefix
const CACHE_KEY_PREFIX = "billboard_cache_";
const CACHE_EXPIRY_DAYS = 7;

// Load cached data from localStorage
function loadCachedData(date: string): CachedBillboardData | null {
    try {
        const key = CACHE_KEY_PREFIX + date;
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        
        const data: CachedBillboardData = JSON.parse(cached);
        
        // Check if cache is expired (7 days)
        const expiryTime = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        if (Date.now() - data.timestamp > expiryTime) {
            localStorage.removeItem(key);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error("Failed to load cached billboard data:", err);
        return null;
    }
}

// Save data to localStorage cache
function saveCachedData(data: CachedBillboardData): void {
    try {
        const key = CACHE_KEY_PREFIX + data.date;
        localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
        console.error("Failed to save billboard cache:", err);
    }
}

export function BillboardPage({ region, billboardDate }: BillboardPageProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isMatchingSpotify, setIsMatchingSpotify] = useState(false);
    const [tracks, setTracks] = useState<TrackMetadata[]>([]);
    const [billboardEntries, setBillboardEntries] = useState<BillboardEntry[]>([]);
    const [matchedIndices, setMatchedIndices] = useState<Set<number>>(new Set());
    const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [chartDate, setChartDate] = useState<string>("");
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState<string>("default");
    const [matchedCount, setMatchedCount] = useState(0);
    const [outputDir, setOutputDir] = useState<string>("");
    const [matchingProgress, setMatchingProgress] = useState(0);
    const [currentMatchingTrack, setCurrentMatchingTrack] = useState<string>("");
    const [matchingStatus, setMatchingStatus] = useState<string>("");
    const stopMatchingRef = useRef(false);

    const download = useDownload(region);
    const ITEMS_PER_PAGE = 50;
    const MAX_RETRIES = 3;
    const BASE_DELAY = 1500;
    const RATE_LIMIT_DELAY = 10000;

    // Load output directory
    useEffect(() => {
        LoadSettings().then((settings) => {
            setOutputDir(settings.outputDir || "");
        });
    }, []);

    // Try to load from cache when date changes
    useEffect(() => {
        if (!billboardDate) return;
        
        const cached = loadCachedData(billboardDate);
        if (cached) {
            setTracks(cached.tracks);
            setBillboardEntries(cached.entries);
            setChartDate(cached.chartDate);
            setMatchedIndices(new Set(cached.matchedIndices));
            setMatchedCount(cached.matchedIndices.length);
            toast.info(`Loaded cached chart for ${cached.chartDate}`);
        }
    }, [billboardDate]);

    // Get the track key for selection/tracking (prefer spotify_id, fallback to isrc or name)
    const getTrackKey = useCallback((track: TrackMetadata): string => {
        return track.spotify_id || track.isrc || `${track.name}-${track.artists}`;
    }, []);

    // Check if a track is matched (has spotify_id)
    const isTrackMatched = useCallback((track: TrackMetadata): boolean => {
        return !!track.spotify_id;
    }, []);

    // Save current state to cache
    const saveToCache = useCallback(() => {
        if (!billboardDate || tracks.length === 0) return;
        
        const cacheData: CachedBillboardData = {
            date: billboardDate,
            chartDate,
            entries: billboardEntries,
            tracks,
            matchedIndices: Array.from(matchedIndices),
            timestamp: Date.now(),
        };
        saveCachedData(cacheData);
    }, [billboardDate, chartDate, billboardEntries, tracks, matchedIndices]);

    // Save to cache when tracks change
    useEffect(() => {
        if (tracks.length > 0 && matchedIndices.size > 0) {
            saveToCache();
        }
    }, [tracks, matchedIndices, saveToCache]);

    const handleFetchChart = async () => {
        if (!billboardDate) {
            toast.error("Please select a date");
            return;
        }

        setIsLoading(true);
        setTracks([]);
        setSelectedTracks([]);
        setCurrentPage(1);
        setMatchedCount(0);
        setMatchedIndices(new Set());
        setBillboardEntries([]);

        try {
            const chart = await FetchBillboardHot100({ date: billboardDate });
            
            if (!chart || !chart.entries || chart.entries.length === 0) {
                toast.error("No chart data found for this date");
                setIsLoading(false);
                return;
            }

            const entries: BillboardEntry[] = chart.entries.map((entry: any) => ({
                rank: entry.rank,
                title: entry.title,
                artist: entry.artist,
            }));
            setBillboardEntries(entries);

            // Convert billboard entries to TrackMetadata format
            const initialTracks: TrackMetadata[] = entries.map((entry) => ({
                name: entry.title,
                artists: entry.artist,
                album_name: "",
                duration_ms: 0,
                images: "",
                release_date: "",
                track_number: entry.rank,
                external_urls: "",
                isrc: "",
            }));

            setTracks(initialTracks);
            setChartDate(chart.date);
            toast.success(`Fetched ${initialTracks.length} tracks from Billboard Hot 100`);

            // Start matching with Spotify (pass empty set and 0 for fresh start)
            matchWithSpotify(entries, initialTracks, 0, new Set(), 0);
        } catch (err: any) {
            console.error("Failed to fetch Billboard chart:", err);
            toast.error(err.message || "Failed to fetch Billboard chart");
        } finally {
            setIsLoading(false);
        }
    };

    const matchWithSpotify = async (
        entries: BillboardEntry[], 
        currentTracks: TrackMetadata[], 
        startIndex: number,
        initialMatchedIndices?: Set<number>,
        initialMatchedCount?: number
    ) => {
        setIsMatchingSpotify(true);
        stopMatchingRef.current = false;

        const updatedTracks = [...currentTracks];
        // Use provided initial values or current state (for resume)
        const newMatchedIndices = initialMatchedIndices !== undefined ? new Set(initialMatchedIndices) : new Set(matchedIndices);
        let matched = initialMatchedCount !== undefined ? initialMatchedCount : matchedCount;

        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        const isRateLimited = (error: any): boolean => {
            const errorMsg = String(error).toLowerCase();
            return errorMsg.includes("429") || 
                   errorMsg.includes("rate") || 
                   errorMsg.includes("too many") ||
                   errorMsg.includes("quota");
        };

        // Find unmatched tracks starting from startIndex
        for (let i = startIndex; i < entries.length; i++) {
            if (stopMatchingRef.current) {
                setMatchingStatus("Matching stopped by user");
                toast.info(`Matching paused at track ${i + 1}. ${matched} tracks matched.`);
                break;
            }

            // Skip already matched tracks
            if (newMatchedIndices.has(i)) {
                continue;
            }

            const entry = entries[i];
            setCurrentMatchingTrack(`${entry.title} - ${entry.artist}`);
            setMatchingProgress(Math.round(((i + 1) / entries.length) * 100));
            setMatchingStatus(`Matching track ${i + 1} of ${entries.length}...`);

            let retryCount = 0;

            while (retryCount < MAX_RETRIES && !stopMatchingRef.current) {
                try {
                    const artistName = entry.artist.split(/[,&]|Featuring|feat\./i)[0].trim();
                    const query = `${entry.title} ${artistName}`;
                    
                    console.log(`[Billboard] Searching for: "${query}"`);
                    const results = await SearchSpotify({ query, limit: 5 });

                    if (results && results.tracks && results.tracks.length > 0) {
                        const matchResult = results.tracks[0];
                        
                        if (matchResult && matchResult.id) {
                            // Use search result data directly
                            updatedTracks[i] = {
                                ...updatedTracks[i],
                                spotify_id: matchResult.id,
                                album_name: matchResult.album_name || "",
                                images: matchResult.images || "",
                                duration_ms: matchResult.duration_ms || 0,
                                external_urls: matchResult.external_urls || "",
                                is_explicit: matchResult.is_explicit || false,
                                release_date: matchResult.release_date || "",
                                // Use spotify_id as isrc for download tracking (download system will fetch real ISRC from Deezer)
                                isrc: matchResult.id,
                            };
                            
                            newMatchedIndices.add(i);
                            matched++;
                            setMatchedCount(matched);
                            setMatchedIndices(new Set(newMatchedIndices));
                            console.log(`[Billboard] Matched: ${entry.title} -> ${matchResult.name} (${matchResult.id})`);
                        }
                    } else {
                        console.log(`[Billboard] No search results for "${entry.title}"`);
                    }
                    
                    // Update UI immediately
                    setTracks([...updatedTracks]);
                    break;
                    
                } catch (err: any) {
                    retryCount++;
                    const errorMsg = String(err);
                    console.error(`[Billboard] Error (attempt ${retryCount}):`, errorMsg);
                    
                    if (isRateLimited(err)) {
                        const waitTime = RATE_LIMIT_DELAY * retryCount;
                        setMatchingStatus(`Rate limited. Waiting ${waitTime / 1000}s before retry (${retryCount}/${MAX_RETRIES})...`);
                        toast.warning(`Rate limited by Spotify. Waiting ${waitTime / 1000} seconds...`);
                        await delay(waitTime);
                    } else if (retryCount < MAX_RETRIES) {
                        setMatchingStatus(`Error matching "${entry.title}". Retry ${retryCount}/${MAX_RETRIES}...`);
                        await delay(BASE_DELAY * retryCount);
                    } else {
                        console.error(`[Billboard] Failed to match "${entry.title}" after ${MAX_RETRIES} retries`);
                        setMatchingStatus(`Failed to match "${entry.title}". Moving on...`);
                    }
                }
            }

            if (i < entries.length - 1 && !stopMatchingRef.current) {
                await delay(BASE_DELAY);
            }
        }

        setIsMatchingSpotify(false);
        setCurrentMatchingTrack("");
        setMatchingStatus("");
        
        // Save to cache after matching completes or is stopped
        saveToCache();
        
        if (!stopMatchingRef.current && matched > 0) {
            toast.success(`Matched ${matched} of ${entries.length} tracks with Spotify`);
        }
    };

    const handleStopMatching = () => {
        stopMatchingRef.current = true;
        setMatchingStatus("Stopping...");
    };

    const handleResumeMatching = () => {
        if (billboardEntries.length === 0 || isMatchingSpotify) return;
        
        // Find first unmatched track
        let startIndex = 0;
        for (let i = 0; i < billboardEntries.length; i++) {
            if (!matchedIndices.has(i)) {
                startIndex = i;
                break;
            }
        }
        
        if (matchedIndices.size >= billboardEntries.length) {
            toast.info("All tracks are already matched");
            return;
        }
        
        toast.info(`Resuming matching from track ${startIndex + 1}`);
        matchWithSpotify(billboardEntries, tracks, startIndex);
    };

    const handleResetMatching = () => {
        if (billboardEntries.length === 0 || isMatchingSpotify) return;
        
        // Reset all matched tracks and start from beginning
        const initialTracks: TrackMetadata[] = billboardEntries.map((entry) => ({
            name: entry.title,
            artists: entry.artist,
            album_name: "",
            duration_ms: 0,
            images: "",
            release_date: "",
            track_number: entry.rank,
            external_urls: "",
            isrc: "",
        }));
        
        setTracks(initialTracks);
        setMatchedIndices(new Set());
        setMatchedCount(0);
        setSelectedTracks([]);
        
        toast.info("Resetting and starting matching from the beginning");
        // Pass empty set and 0 to force fresh start
        matchWithSpotify(billboardEntries, initialTracks, 0, new Set(), 0);
    };

    const toggleTrackSelection = (trackKey: string) => {
        setSelectedTracks(prev => 
            prev.includes(trackKey) ? prev.filter(k => k !== trackKey) : [...prev, trackKey]
        );
    };

    const toggleSelectAll = (trackList: TrackMetadata[]) => {
        // Only select matched tracks (those with spotify_id)
        const selectableTracks = trackList
            .filter(t => isTrackMatched(t))
            .map(t => getTrackKey(t));
        
        const allSelected = selectableTracks.length > 0 && 
            selectableTracks.every(key => selectedTracks.includes(key));
        
        if (allSelected) {
            setSelectedTracks(prev => prev.filter(key => !selectableTracks.includes(key)));
        } else {
            setSelectedTracks(prev => Array.from(new Set([...prev, ...selectableTracks])));
        }
    };

    const handleDownloadSelected = async () => {
        const tracksToDownload = tracks.filter(t => {
            const key = getTrackKey(t);
            return selectedTracks.includes(key) && isTrackMatched(t);
        });

        if (tracksToDownload.length === 0) {
            toast.error("No matched tracks selected for download");
            return;
        }

        // Check Billboard folder mode setting
        const settings = getSettings();
        const folderName = settings.billboardFolderMode === "billboard" ? `Billboard Hot 100 - ${chartDate}` : undefined;

        // Use the queue-based download from the hook
        const trackKeys = tracksToDownload.map(t => getTrackKey(t));
        await download.handleDownloadSelected(trackKeys, tracksToDownload, folderName);
    };

    const handleDownloadAll = async () => {
        const matchedTracksList = tracks.filter(t => isTrackMatched(t));
        
        if (matchedTracksList.length === 0) {
            toast.error("No matched tracks to download");
            return;
        }

        // Check Billboard folder mode setting
        const settings = getSettings();
        const folderName = settings.billboardFolderMode === "billboard" ? `Billboard Hot 100 - ${chartDate}` : undefined;

        // Use the queue-based download from the hook
        await download.handleDownloadAll(matchedTracksList, folderName);
    };

    const handleStopDownload = () => {
        download.handleStopDownload();
    };

    const handleOpenFolder = async () => {
        if (outputDir) {
            const settings = getSettings();
            const folderPath = settings.billboardFolderMode === "billboard" 
                ? `${outputDir}/Billboard Hot 100 - ${chartDate}` 
                : outputDir;
            try {
                await OpenFolder(folderPath);
            } catch (err) {
                console.error("Failed to open folder:", err);
            }
        }
    };

    const matchedTracks = tracks.filter(t => isTrackMatched(t));
    const hasUnmatchedTracks = matchedIndices.size < billboardEntries.length && billboardEntries.length > 0;

    // Expose fetch function for parent component to call
    useEffect(() => {
        // Store the fetch function on window for external access
        (window as any).__billboardFetch = handleFetchChart;
        return () => {
            delete (window as any).__billboardFetch;
        };
    }, [billboardDate]);

    // Empty state when no chart loaded
    if (!isLoading && tracks.length === 0) {
        return (
            <div className="text-center py-16">
                <div className="w-24 h-24 rounded-md bg-gradient-to-br from-yellow-400 via-red-500 to-pink-500 flex items-center justify-center mx-auto mb-4 p-4">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90" className="w-full h-full fill-white">
                        <path d="M34.995 31.265V8H18v73.284h16.693v-4.819C38.717 80.257 43.039 82 48.37 82 61.341 82 72 70.316 72 55.15c0-16.094-11.058-27.265-25.238-27.265-4.626 0-8.449 1.027-11.767 3.38Zm.102 23.918c0-5.544 4.413-10.042 9.856-10.042 5.44 0 9.853 4.498 9.853 10.042 0 5.549-4.413 10.047-9.853 10.047-5.443 0-9.856-4.498-9.856-10.047Z" fillRule="nonzero"/>
                    </svg>
                </div>
                <h3 className="text-lg font-medium mb-2">No Chart Data</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Select a date and click "Fetch Chart" to load the Billboard Hot 100
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header Card - just like PlaylistInfo */}
            <Card>
                <CardContent className="px-6">
                    <div className="flex gap-6 items-start">
                        <BillboardLogo />
                        <div className="flex-1 space-y-4">
                            <div className="space-y-2">
                                <p className="text-sm font-medium">Chart</p>
                                <h2 className="text-4xl font-bold">Billboard Hot 100</h2>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <span>{chartDate}</span>
                                    <span>•</span>
                                    <span>{tracks.length} tracks</span>
                                    <span>•</span>
                                    <span>{matchedCount} matched</span>
                                </div>
                            </div>

                            {/* Matching Progress Section */}
                            {isMatchingSpotify && (
                                <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <span className="font-medium">Matching with Spotify</span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleStopMatching}
                                            className="h-7 px-2"
                                        >
                                            <StopCircle className="h-4 w-4 mr-1" />
                                            Stop
                                        </Button>
                                    </div>
                                    <Progress value={matchingProgress} className="h-2" />
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span className="truncate max-w-[300px]">{currentMatchingTrack}</span>
                                        <span>{matchingProgress}%</span>
                                    </div>
                                    {matchingStatus && (
                                        <p className="text-xs text-muted-foreground">{matchingStatus}</p>
                                    )}
                                </div>
                            )}
                            <div className="flex gap-2 flex-wrap">
                                <Button 
                                    onClick={handleDownloadAll} 
                                    disabled={download.isDownloading || matchedTracks.length === 0}
                                >
                                    {download.isDownloading && download.bulkDownloadType === "all" ? (
                                        <Spinner />
                                    ) : (
                                        <Download className="h-4 w-4" />
                                    )}
                                    Download All ({matchedTracks.length})
                                </Button>
                                {selectedTracks.length > 0 && (
                                    <Button 
                                        onClick={handleDownloadSelected} 
                                        variant="secondary" 
                                        disabled={download.isDownloading}
                                    >
                                        {download.isDownloading && download.bulkDownloadType === "selected" ? (
                                            <Spinner />
                                        ) : (
                                            <Download className="h-4 w-4" />
                                        )}
                                        Download Selected ({selectedTracks.length})
                                    </Button>
                                )}
                                {/* Resume Matching Button */}
                                {hasUnmatchedTracks && !isMatchingSpotify && (
                                    <Button 
                                        onClick={handleResumeMatching} 
                                        variant="outline"
                                        disabled={isMatchingSpotify}
                                    >
                                        <Play className="h-4 w-4" />
                                        Resume Matching ({billboardEntries.length - matchedIndices.size} left)
                                    </Button>
                                )}
                                {/* Reset Matching Button */}
                                {billboardEntries.length > 0 && !isMatchingSpotify && (
                                    <Button 
                                        onClick={handleResetMatching} 
                                        variant="outline"
                                        disabled={isMatchingSpotify}
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        Reset Matching
                                    </Button>
                                )}
                                {download.downloadedTracks.size > 0 && (
                                    <Button onClick={handleOpenFolder} variant="outline">
                                        <FolderOpen className="h-4 w-4" />
                                        Open Folder
                                    </Button>
                                )}
                            </div>
                            {download.isDownloading && download.bulkDownloadType && (
                                <DownloadProgress 
                                    progress={download.downloadProgress} 
                                    currentTrack={download.currentDownloadInfo} 
                                    onStop={handleStopDownload}
                                />
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Search and Sort */}
            <div className="space-y-4">
                <SearchAndSort
                    searchQuery={searchQuery}
                    sortBy={sortBy}
                    onSearchChange={setSearchQuery}
                    onSortChange={setSortBy}
                />

                {/* Track List - exactly like PlaylistInfo */}
                <TrackList
                    tracks={tracks}
                    searchQuery={searchQuery}
                    sortBy={sortBy}
                    selectedTracks={selectedTracks}
                    downloadedTracks={download.downloadedTracks}
                    failedTracks={download.failedTracks}
                    skippedTracks={download.skippedTracks}
                    downloadingTrack={download.downloadingTrack}
                    isDownloading={download.isDownloading}
                    currentPage={currentPage}
                    itemsPerPage={ITEMS_PER_PAGE}
                    showCheckboxes={true}
                    hideAlbumColumn={false}
                    folderName={`Billboard Hot 100 - ${chartDate}`}
                    onToggleTrack={toggleTrackSelection}
                    onToggleSelectAll={toggleSelectAll}
                    onDownloadTrack={download.handleDownloadTrack}
                    onPageChange={setCurrentPage}
                />
            </div>
        </div>
    );
}

// Export a function to get the current billboard date
export async function getCurrentBillboardDate(): Promise<string> {
    try {
        return await GetCurrentBillboardDate();
    } catch (err) {
        console.error("Failed to get current billboard date:", err);
        return new Date().toISOString().split("T")[0];
    }
}

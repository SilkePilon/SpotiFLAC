package backend

import (
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// BillboardEntry represents a single song on the Billboard chart
type BillboardEntry struct {
	Rank         int    `json:"rank"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	LastWeekRank int    `json:"last_week_rank"`
	PeakRank     int    `json:"peak_rank"`
	WeeksOnChart int    `json:"weeks_on_chart"`
	IsNew        bool   `json:"is_new"`
}

// BillboardChart represents the full chart data
type BillboardChart struct {
	Date    string           `json:"date"`
	Entries []BillboardEntry `json:"entries"`
}

// FetchBillboardHot100 fetches the Billboard Hot 100 chart for a given date
func FetchBillboardHot100(ctx context.Context, date string) (*BillboardChart, error) {
	// Validate date format (YYYY-MM-DD)
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return nil, fmt.Errorf("invalid date format, expected YYYY-MM-DD: %w", err)
	}

	url := fmt.Sprintf("https://www.billboard.com/charts/hot-100/%s/", date)

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers to mimic a browser request
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Billboard chart: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Billboard returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	htmlContent := string(body)

	entries, err := parseBillboardHTML(htmlContent)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Billboard chart: %w", err)
	}

	return &BillboardChart{
		Date:    date,
		Entries: entries,
	}, nil
}

// parseBillboardHTML extracts chart entries from the Billboard HTML
// Based on the billboard.py Python library parsing approach
func parseBillboardHTML(htmlContent string) ([]BillboardEntry, error) {
	entries := []BillboardEntry{}

	// Billboard uses ul.o-chart-results-list-row for each chart entry
	// Each row contains: rank, image, title (h3#title-of-a-story), artist (span.c-label), stats
	
	// Pattern to find chart rows - looking for the row structure
	rowPattern := regexp.MustCompile(`(?s)<ul[^>]*class="[^"]*o-chart-results-list-row[^"]*"[^>]*>(.*?)</ul>`)
	rows := rowPattern.FindAllStringSubmatch(htmlContent, -1)

	if len(rows) == 0 {
		// Try alternative extraction - looking for title-of-a-story directly
		return parseDirectExtraction(htmlContent)
	}

	for _, row := range rows {
		if len(row) < 2 {
			continue
		}
		
		rowContent := row[1]
		entry := extractChartEntry(rowContent)
		
		if entry.Title != "" && entry.Artist != "" && entry.Rank > 0 {
			entries = append(entries, entry)
		}
	}

	// If we didn't get entries from rows, try direct extraction
	if len(entries) == 0 {
		return parseDirectExtraction(htmlContent)
	}

	return entries, nil
}

// extractChartEntry extracts a single chart entry from a row's HTML content
func extractChartEntry(rowContent string) BillboardEntry {
	entry := BillboardEntry{}

	// Extract rank from first span.c-label (should be just a number)
	rankPattern := regexp.MustCompile(`<li[^>]*>\s*<span[^>]*class="[^"]*c-label[^"]*"[^>]*>\s*(\d+)\s*</span>`)
	rankMatches := rankPattern.FindStringSubmatch(rowContent)
	if len(rankMatches) >= 2 {
		entry.Rank, _ = strconv.Atoi(strings.TrimSpace(rankMatches[1]))
	}

	// Extract title from h3#title-of-a-story
	titlePattern := regexp.MustCompile(`(?s)<h3[^>]*id="title-of-a-story"[^>]*>\s*(.*?)\s*</h3>`)
	titleMatches := titlePattern.FindStringSubmatch(rowContent)
	if len(titleMatches) >= 2 {
		entry.Title = cleanText(titleMatches[1])
	}

	// Extract artist - it's the span.c-label that follows the title (not a number)
	// The artist span has classes like c-label, a-no-trucate, a-font-primary-s
	artistPattern := regexp.MustCompile(`(?s)id="title-of-a-story"[^>]*>.*?</h3>\s*<span[^>]*class="[^"]*c-label[^"]*"[^>]*>\s*(.*?)\s*</span>`)
	artistMatches := artistPattern.FindStringSubmatch(rowContent)
	if len(artistMatches) >= 2 {
		entry.Artist = cleanText(artistMatches[1])
	}

	// If artist not found, try alternative patterns
	if entry.Artist == "" {
		// Look for artist link pattern
		artistLinkPattern := regexp.MustCompile(`(?s)<a[^>]*href="/artist/[^"]*"[^>]*>\s*(.*?)\s*</a>`)
		artistLinkMatches := artistLinkPattern.FindStringSubmatch(rowContent)
		if len(artistLinkMatches) >= 2 {
			entry.Artist = cleanText(artistLinkMatches[1])
		}
	}

	// Extract stats (last week, peak, weeks)
	entry.LastWeekRank = extractStat(rowContent, 3) // Last week is usually at index 3
	entry.PeakRank = extractStat(rowContent, 4)     // Peak is usually at index 4
	entry.WeeksOnChart = extractStat(rowContent, 5) // Weeks is usually at index 5

	// Check if it's a new entry
	if strings.Contains(rowContent, ">NEW<") || strings.Contains(rowContent, ">NEW ") {
		entry.IsNew = true
	}

	return entry
}

// parseDirectExtraction attempts direct extraction when row pattern fails
func parseDirectExtraction(htmlContent string) ([]BillboardEntry, error) {
	entries := []BillboardEntry{}

	// Find all titles with id="title-of-a-story"
	titlePattern := regexp.MustCompile(`(?s)<h3[^>]*id="title-of-a-story"[^>]*>\s*(.*?)\s*</h3>`)
	titleMatches := titlePattern.FindAllStringSubmatch(htmlContent, -1)

	// For each title, find the corresponding artist and rank by looking at surrounding context
	for i, titleMatch := range titleMatches {
		if len(titleMatch) < 2 {
			continue
		}

		title := cleanText(titleMatch[1])
		if title == "" {
			continue
		}

		entry := BillboardEntry{
			Rank:  i + 1,
			Title: title,
		}

		// Find the position of this title in the HTML
		titlePos := strings.Index(htmlContent, titleMatch[0])
		if titlePos == -1 {
			continue
		}

		// Look for artist in the content after the title (within 500 chars)
		endPos := titlePos + len(titleMatch[0]) + 500
		if endPos > len(htmlContent) {
			endPos = len(htmlContent)
		}
		afterTitle := htmlContent[titlePos+len(titleMatch[0]) : endPos]

		// Artist is in span with c-label class right after the h3
		artistPattern := regexp.MustCompile(`(?s)^\s*<span[^>]*class="[^"]*c-label[^"]*"[^>]*>\s*(.*?)\s*</span>`)
		artistMatches := artistPattern.FindStringSubmatch(afterTitle)
		if len(artistMatches) >= 2 {
			entry.Artist = cleanText(artistMatches[1])
		}

		// If no artist found, try looking for anchor links
		if entry.Artist == "" {
			artistLinkPattern := regexp.MustCompile(`(?s)<a[^>]*href="/artist/[^"]*"[^>]*>\s*(.*?)\s*</a>`)
			artistLinkMatches := artistLinkPattern.FindAllStringSubmatch(afterTitle, 3)
			if len(artistLinkMatches) > 0 {
				// Combine all artist names
				var artists []string
				for _, m := range artistLinkMatches {
					if len(m) >= 2 {
						artist := cleanText(m[1])
						if artist != "" {
							artists = append(artists, artist)
						}
					}
				}
				entry.Artist = strings.Join(artists, ", ")
			}
		}

		// Look for rank in the content before the title (within 300 chars)
		startPos := titlePos - 300
		if startPos < 0 {
			startPos = 0
		}
		beforeTitle := htmlContent[startPos:titlePos]

		// Look for the last number before the title that looks like a rank
		rankPattern := regexp.MustCompile(`>\s*(\d{1,3})\s*<`)
		rankMatches := rankPattern.FindAllStringSubmatch(beforeTitle, -1)
		if len(rankMatches) > 0 {
			lastMatch := rankMatches[len(rankMatches)-1]
			if len(lastMatch) >= 2 {
				rank, _ := strconv.Atoi(strings.TrimSpace(lastMatch[1]))
				if rank >= 1 && rank <= 100 {
					entry.Rank = rank
				}
			}
		}

		if entry.Title != "" && entry.Artist != "" {
			entries = append(entries, entry)
		}
	}

	return entries, nil
}

// extractStat extracts a stat value from a specific li position in the row
func extractStat(rowContent string, liIndex int) int {
	// Split by <li> tags and get the value at the specified index
	liPattern := regexp.MustCompile(`(?s)<li[^>]*>(.*?)</li>`)
	liMatches := liPattern.FindAllStringSubmatch(rowContent, -1)

	if liIndex < len(liMatches) && len(liMatches[liIndex]) >= 2 {
		content := liMatches[liIndex][1]
		// Extract the numeric value
		numPattern := regexp.MustCompile(`>\s*(\d+)\s*<`)
		numMatches := numPattern.FindStringSubmatch(content)
		if len(numMatches) >= 2 {
			num, _ := strconv.Atoi(strings.TrimSpace(numMatches[1]))
			return num
		}
		// Also try just extracting any number
		numPattern2 := regexp.MustCompile(`(\d+)`)
		numMatches2 := numPattern2.FindStringSubmatch(content)
		if len(numMatches2) >= 2 {
			num, _ := strconv.Atoi(strings.TrimSpace(numMatches2[1]))
			return num
		}
	}

	return 0
}

// cleanText cleans extracted text by decoding HTML entities and trimming whitespace
func cleanText(text string) string {
	// Decode HTML entities (&#039; -> ', &amp; -> &, etc.)
	text = html.UnescapeString(text)
	
	// Remove any HTML tags that might be in the text
	tagPattern := regexp.MustCompile(`<[^>]*>`)
	text = tagPattern.ReplaceAllString(text, "")
	
	// Normalize whitespace
	text = strings.TrimSpace(text)
	text = regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")
	
	return text
}

// GetCurrentBillboardDate returns the most recent Saturday (Billboard updates on Saturday)
func GetCurrentBillboardDate() string {
	now := time.Now()
	// Billboard chart date is the Saturday of the chart week
	// We want to get the most recent Saturday
	daysUntilSaturday := (int(now.Weekday()) + 1) % 7
	if daysUntilSaturday == 0 && now.Weekday() != time.Saturday {
		daysUntilSaturday = 7
	}
	
	// Get the most recent Saturday that has been published
	// Charts are typically available by Wednesday for the following Saturday
	saturday := now.AddDate(0, 0, -int(now.Weekday()+1)%7)
	if saturday.After(now) {
		saturday = saturday.AddDate(0, 0, -7)
	}

	return saturday.Format("2006-01-02")
}

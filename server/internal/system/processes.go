// SPDX-License-Identifier: AGPL-3.0-only
package system

import (
	"fmt"
	"math"
	"os"
	"os/user"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

type Process struct {
	PID         int      `json:"pid"`
	Name        string   `json:"name"`
	User        string   `json:"user"`
	State       string   `json:"state"`
	CPUPercent  *float64 `json:"cpuPercent"`
	MemoryBytes uint64   `json:"memoryBytes"`
	ticks       uint64
	start       uint64
}

type ProcessSampler struct {
	mu       sync.Mutex
	previous map[int]Process
	total    uint64
}

func parseProcessStat(raw string) (Process, error) {
	first, last := strings.Index(raw, "("), strings.LastIndex(raw, ")")
	if first < 1 || last <= first {
		return Process{}, fmt.Errorf("invalid process stat")
	}
	pid, err := strconv.Atoi(strings.TrimSpace(raw[:first]))
	fields := strings.Fields(raw[last+1:])
	if err != nil || len(fields) < 22 {
		return Process{}, fmt.Errorf("invalid process stat")
	}
	values := make([]uint64, 4)
	for i, index := range []int{11, 12, 19, 21} {
		value, err := strconv.ParseUint(fields[index], 10, 64)
		if err != nil {
			return Process{}, err
		}
		values[i] = value
	}
	return Process{PID: pid, Name: raw[first+1 : last], State: fields[0], ticks: values[0] + values[1], start: values[2], MemoryBytes: values[3] * uint64(os.Getpagesize())}, nil
}

func (s *ProcessSampler) Sample() ([]Process, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return nil, err
	}
	total, ok := parseCPUTimes(string(data))
	if !ok {
		return nil, fmt.Errorf("CPU counters unavailable")
	}
	cores := len(parseCoreTimes(string(data)))
	current := map[int]Process{}
	users := map[string]string{}
	result := []Process{}
	for _, entry := range entries {
		if _, err := strconv.Atoi(entry.Name()); err != nil {
			continue
		}
		dir := filepath.Join("/proc", entry.Name())
		raw, err := os.ReadFile(filepath.Join(dir, "stat"))
		if err != nil {
			continue
		}
		process, err := parseProcessStat(string(raw))
		if err != nil {
			continue
		}
		info, err := os.Stat(dir)
		if err != nil {
			continue
		}
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			uid := strconv.FormatUint(uint64(stat.Uid), 10)
			name, found := users[uid]
			if !found {
				name = uid
				if account, err := user.LookupId(uid); err == nil {
					name = account.Username
				}
				users[uid] = name
			}
			process.User = name
		}
		previous, seen := s.previous[process.PID]
		if seen && previous.start == process.start && total.total > s.total && process.ticks >= previous.ticks {
			percent := math.Round(float64(process.ticks-previous.ticks)/float64(total.total-s.total)*float64(cores)*1000) / 10
			process.CPUPercent = &percent
		}
		current[process.PID] = process
		result = append(result, process)
	}
	s.previous, s.total = current, total.total
	sort.Slice(result, func(i, j int) bool { return result[i].PID < result[j].PID })
	return result, nil
}

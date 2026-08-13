// SPDX-License-Identifier: AGPL-3.0-only
package gateway

import (
	"sync"
	"time"
)

const (
	accountLimiterThreshold = 3
	sourceLimiterThreshold  = 12
	limiterMaxDelay         = 60 * time.Second
	limiterWindow           = 15 * time.Minute
	limiterMaxEntries       = 4096
)

type loginLimiter struct {
	mu        sync.Mutex
	failed    map[string]*limiterEntry
	threshold int
	now       func() time.Time
}

type limiterEntry struct {
	count       int
	blocked     time.Time
	lastFailure time.Time
}

func newLoginLimiter(threshold int) *loginLimiter {
	return &loginLimiter{failed: map[string]*limiterEntry{}, threshold: threshold, now: time.Now}
}

func (l *loginLimiter) blocked(key string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.failed[key]
	if !ok {
		return 0
	}
	now := l.now()
	if now.Sub(entry.lastFailure) >= limiterWindow {
		delete(l.failed, key)
		return 0
	}
	if remaining := entry.blocked.Sub(now); remaining > 0 {
		return remaining
	}
	return 0
}

func (l *loginLimiter) record(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	entry, ok := l.failed[key]
	if ok && now.Sub(entry.lastFailure) >= limiterWindow {
		delete(l.failed, key)
		entry = nil
		ok = false
	}
	if !ok {
		if len(l.failed) >= limiterMaxEntries {
			l.evictOldest()
		}
		entry = &limiterEntry{}
		l.failed[key] = entry
	}
	entry.count++
	entry.lastFailure = now
	if entry.count >= l.threshold {
		exponent := min(entry.count-l.threshold+1, 6)
		delay := time.Duration(1<<exponent) * time.Second
		if delay > limiterMaxDelay {
			delay = limiterMaxDelay
		}
		entry.blocked = now.Add(delay)
	}
}

func (l *loginLimiter) reset(key string) {
	l.mu.Lock()
	delete(l.failed, key)
	l.mu.Unlock()
}

func (l *loginLimiter) evictOldest() {
	oldestKey := ""
	oldestAt := time.Time{}
	for key, entry := range l.failed {
		if oldestKey == "" || entry.lastFailure.Before(oldestAt) {
			oldestKey = key
			oldestAt = entry.lastFailure
		}
	}
	delete(l.failed, oldestKey)
}

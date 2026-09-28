// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type locationMoveRecord struct {
	PreviousRevision string
	TrashInfo        string
	Revision         string
	Entries          []locationMoveRecordEntry
}

type locationMoveRecordEntry struct {
	From, To, Backup, Signature string
	Published                   bool
}

func saveLocationMove(config, previousRevision, revision string, entries []movedLocationEntry) error {
	return saveLocationMoveWithTrash(config, previousRevision, revision, entries, "")
}

func saveLocationMoveWithTrash(config, previousRevision, revision string, entries []movedLocationEntry, trashInfo string) error {
	record := locationMoveRecord{Revision: revision, PreviousRevision: previousRevision, TrashInfo: trashInfo}
	for _, item := range entries {
		record.Entries = append(record.Entries, locationMoveRecordEntry{From: item.from, To: item.to, Backup: item.backup, Signature: item.signature, Published: item.published})
	}
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(config), ".lumo-move-record-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(file.Name(), config+".lumo-move.json"); err != nil {
		return err
	}
	syncDir(filepath.Dir(config))
	return nil
}

func recoverLocationMove() error {
	_, config, err := locationConfigPath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(config + ".lumo-move.json")
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var record locationMoveRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return fmt.Errorf("folder move recovery record cannot be read: %w", err)
	}
	moved := []movedLocationEntry{}
	for _, item := range record.Entries {
		if !filepath.IsAbs(item.From) || !filepath.IsAbs(item.To) || !filepath.IsAbs(item.Backup) || filepath.Dir(filepath.Dir(item.Backup)) != filepath.Dir(item.From) || !strings.HasPrefix(filepath.Base(filepath.Dir(item.Backup)), ".lumo-folder-move-") {
			return fmt.Errorf("folder move recovery record has invalid paths")
		}
		moved = append(moved, movedLocationEntry{from: item.From, to: item.To, backup: item.Backup, signature: item.Signature, published: item.Published})
	}
	_, revision, err := readLocationConfig(config)
	if err != nil {
		return err
	}
	if revision == record.Revision {
		finishLocationMoves(moved)
	} else if revision != record.PreviousRevision {
		return fmt.Errorf("folder configuration changed after an interrupted move; recovery files were preserved")
	} else if err := rollbackLocationMoves(moved); err != nil {
		return fmt.Errorf("folder move recovery requires attention: %w", err)
	}
	if revision == record.PreviousRevision && record.TrashInfo != "" {
		dir, err := trashDir()
		if err != nil {
			return err
		}
		dir, err = filepath.EvalSymlinks(dir)
		if err != nil {
			return err
		}
		if filepath.Dir(record.TrashInfo) != filepath.Join(dir, "info") || !strings.HasSuffix(record.TrashInfo, ".trashinfo") {
			return fmt.Errorf("invalid Trash recovery path")
		}
		_ = os.Remove(record.TrashInfo)
	}
	return os.Remove(config + ".lumo-move.json")
}

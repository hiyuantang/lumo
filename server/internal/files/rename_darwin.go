// SPDX-License-Identifier: AGPL-3.0-only
package files

import "golang.org/x/sys/unix"

func renameExclusive(from, to string) error {
	return unix.RenamexNp(from, to, unix.RENAME_EXCL)
}

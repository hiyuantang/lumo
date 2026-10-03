// SPDX-License-Identifier: AGPL-3.0-only
package main

import "lumo/server/internal/httpkit"

type Error = httpkit.Error

const CodeUnauthorized = httpkit.CodeUnauthorized
const CodeForbidden = httpkit.CodeForbidden
const CodeNotFound = httpkit.CodeNotFound
const CodeConflict = httpkit.CodeConflict
const CodeStaleRevision = httpkit.CodeStaleRevision
const CodeValidationFailed = httpkit.CodeValidationFailed
const CodeBusy = httpkit.CodeBusy
const CodeUnavailable = httpkit.CodeUnavailable
const CodeInternal = httpkit.CodeInternal

var NewError = httpkit.NewError
var WriteData = httpkit.WriteData
var WriteError = httpkit.WriteError
var StatusFor = httpkit.StatusFor
var MapError = httpkit.MapError

// SPDX-License-Identifier: AGPL-3.0-only
package gateway

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTransportPolicy(t *testing.T) {
	for _, test := range []struct {
		addr, cert, key string
		insecure, ok    bool
	}{
		{"127.0.0.1:8080", "", "", false, true},
		{"[::1]:8080", "", "", false, true},
		{":43128", "", "", false, false},
		{"0.0.0.0:43128", "cert", "key", false, true},
		{"0.0.0.0:8080", "", "", true, true},
		{"127.0.0.1:8080", "cert", "", false, false},
		{"invalid", "cert", "key", false, false},
	} {
		err := ValidateTransport(test.addr, test.cert, test.key, test.insecure)
		if (err == nil) != test.ok {
			t.Errorf("transport %s: %v", test.addr, err)
		}
	}
}

func TestCertificateReloadKeepsLastValidPair(t *testing.T) {
	directory := t.TempDir()
	certPath := filepath.Join(directory, "cert.pem")
	keyPath := filepath.Join(directory, "key.pem")
	writePair := func(serial int64) {
		t.Helper()
		public, private, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		template := &x509.Certificate{SerialNumber: big.NewInt(serial), NotBefore: time.Now(), NotAfter: time.Now().Add(time.Hour)}
		certificate, err := x509.CreateCertificate(rand.Reader, template, template, public, private)
		if err != nil {
			t.Fatal(err)
		}
		key, err := x509.MarshalPKCS8PrivateKey(private)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate}), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writePair(1)
	certificate, err := NewCertificate(certPath, keyPath)
	if err != nil {
		t.Fatal(err)
	}
	config := certificate.Config()
	if config.MinVersion != tls.VersionTLS12 {
		t.Fatal("TLS minimum version is missing")
	}
	first, _ := config.GetCertificate(nil)
	writePair(2)
	if err := certificate.Reload(); err != nil {
		t.Fatal(err)
	}
	second, _ := config.GetCertificate(nil)
	if first == second {
		t.Fatal("certificate did not change after renewal")
	}
	if err := os.WriteFile(keyPath, []byte("invalid key"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := certificate.Reload(); err == nil {
		t.Fatal("invalid renewal was accepted")
	}
	retained, _ := config.GetCertificate(nil)
	if retained != second {
		t.Fatal("invalid renewal displaced the working certificate")
	}
}

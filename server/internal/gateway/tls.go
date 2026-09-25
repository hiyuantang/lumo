// SPDX-License-Identifier: AGPL-3.0-only
package gateway

import (
	"crypto/tls"
	"errors"
	"net"
	"sync/atomic"
)

type Certificate struct {
	current  atomic.Pointer[tls.Certificate]
	certFile string
	keyFile  string
}

func NewCertificate(certFile, keyFile string) (*Certificate, error) {
	c := &Certificate{certFile: certFile, keyFile: keyFile}
	if err := c.Reload(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Certificate) Reload() error {
	pair, err := tls.LoadX509KeyPair(c.certFile, c.keyFile)
	if err != nil {
		return err
	}
	c.current.Store(&pair)
	return nil
}

func (c *Certificate) Config() *tls.Config {
	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
			return c.current.Load(), nil
		},
	}
}

func ValidateTransport(addr, certFile, keyFile string, insecure bool) error {
	if (certFile == "") != (keyFile == "") {
		return errors.New("both -tls-cert and -tls-key are required")
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if certFile != "" || insecure || host == "localhost" || net.ParseIP(host).IsLoopback() {
		return nil
	}
	return errors.New("public listeners require HTTPS; use -tls-cert and -tls-key (test containers may explicitly use -insecure-http)")
}

// Command sentinel is the x404 sentinel proxy.
//
// It serves a local content-addressed registry. Containers answer HTTP 404
// until the client presents the 448-byte seal key for that file. The process
// does not dial a chain, does not invent transaction hashes, and does not
// load protected health information.
//
//	go run ./cmd/sentinel
//	go run ./cmd/sentinel -mint apollo11-sstv
//	go run ./cmd/sentinel -file
package main

import (
	"context"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/masterledgerlive/x404-sentinel/internal/proxy"
)

func main() {
	addr := flag.String("addr", ":18080", "listen address")
	root := flag.String("root", "", "project root (directory containing SENTINEL.md); default walks up from the working directory")
	mint := flag.String("mint", "", "print the seal key hex for a registry id and exit")
	fileCells := flag.Bool("file", false, "write grouped cell files and the Apollo demo proof hex, then exit")
	flag.Parse()
	if *mint != "" && *fileCells {
		fmt.Fprintln(os.Stderr, "sentinel: use only one of -mint or -file")
		os.Exit(2)
	}

	project, err := findRoot(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "sentinel:", err)
		os.Exit(1)
	}
	reg := proxy.NewRegistry()
	if err := proxy.LoadFixtures(reg, project); err != nil {
		fmt.Fprintln(os.Stderr, "sentinel:", err)
		os.Exit(1)
	}

	if *fileCells {
		if err := proxy.WriteFilings(reg, project); err != nil {
			fmt.Fprintln(os.Stderr, "sentinel:", err)
			os.Exit(1)
		}
		if err := proxy.VerifyFilings(reg, project); err != nil {
			fmt.Fprintln(os.Stderr, "sentinel:", err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, "filed cells and demo proof under", project)
		return
	}
	if *mint != "" {
		c, ok := proxy.ContainerByID(reg, *mint)
		if !ok {
			fmt.Fprintln(os.Stderr, "sentinel: unknown id")
			os.Exit(1)
		}
		// Stdout is the hex only, so scripts can capture it.
		fmt.Println(hex.EncodeToString(c.SealCopy()))
		return
	}
	if err := proxy.VerifyFilings(reg, project); err != nil {
		fmt.Fprintln(os.Stderr, "sentinel:", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           proxy.NewServer(reg, proxy.NewTelemetry(256, os.Stderr), project),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shctx)
	}()
	log.Printf("x404-sentinel listening on %s (local sha256 commits, chain=none)", *addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(os.Stderr, "sentinel:", err)
		os.Exit(1)
	}
}

func findRoot(flagged string) (string, error) {
	if flagged != "" {
		return flagged, nil
	}
	if env := os.Getenv("SENTINEL_ROOT"); env != "" {
		return env, nil
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "SENTINEL.md")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", errors.New("SENTINEL.md not found; pass -root")
}

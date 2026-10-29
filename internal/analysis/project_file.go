package analysis

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"os"
	"path/filepath"
)

// A .motion file is a ZIP containing its manifest and the original video files.
type projectFile struct {
	Format    string    `json:"format"`
	Schema    int       `json:"schema"`
	Videos    []Project `json:"videos"`
	Workspace Workspace `json:"workspace"`
}

func (s Store) ExportProject(id string) (path string, err error) {
	workspace, err := s.LoadWorkspace(id)
	if err != nil {
		return "", err
	}
	if workspace == nil {
		return "", fmt.Errorf("save workspace before saving a project file")
	}
	if err = s.validateWorkspace(id, workspace); err != nil {
		return "", err
	}
	file, err := os.CreateTemp("", "motion-project-*.motion")
	if err != nil {
		return "", err
	}
	path = file.Name()
	defer func() {
		file.Close()
		if err != nil {
			os.Remove(file.Name())
		}
	}()
	archive := zip.NewWriter(file)
	manifest := projectFile{Format: "motion-tracker", Schema: 1, Workspace: *workspace}
	for i, track := range workspace.Tracks {
		p, e := s.Load(track.ID)
		if e != nil {
			return "", e
		}
		if filepath.Base(p.Source) != p.Source {
			return "", fmt.Errorf("invalid video source")
		}
		folder, _ := s.Folder(p.ID)
		source, e := os.Open(filepath.Join(folder, p.Source))
		if e != nil {
			return "", e
		}
		name := fmt.Sprintf("media/%d%s", i, filepath.Ext(p.Source))
		entry, e := archive.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if e == nil {
			_, e = io.Copy(entry, source)
		}
		source.Close()
		if e != nil {
			return "", e
		}
		copy := *p
		copy.Source = name
		manifest.Videos = append(manifest.Videos, copy)
	}
	entry, err := archive.Create("project.json")
	if err != nil {
		return "", err
	}
	if err = json.NewEncoder(entry).Encode(manifest); err != nil {
		return "", err
	}
	if err = archive.Close(); err != nil {
		return "", err
	}
	return path, file.Close()
}

func (s Store) ImportProject(path string) (_ *Workspace, err error) {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("invalid project file: %w", err)
	}
	defer archive.Close()
	if len(archive.File) > 3 {
		return nil, fmt.Errorf("unexpected project contents")
	}
	entries := map[string]*zip.File{}
	var total uint64
	for _, file := range archive.File {
		if entries[file.Name] != nil {
			return nil, fmt.Errorf("duplicate project entry")
		}
		total += file.UncompressedSize64
		if file.UncompressedSize64 > 256<<20 || total > 512<<20 {
			return nil, fmt.Errorf("project exceeds 512 MB")
		}
		entries[file.Name] = file
	}
	manifestFile := entries["project.json"]
	if manifestFile == nil || manifestFile.UncompressedSize64 > 8<<20 {
		return nil, fmt.Errorf("missing or oversized project manifest")
	}
	reader, err := manifestFile.Open()
	if err != nil {
		return nil, err
	}
	var manifest projectFile
	err = json.NewDecoder(io.LimitReader(reader, 8<<20)).Decode(&manifest)
	reader.Close()
	if err != nil {
		return nil, err
	}
	if manifest.Format != "motion-tracker" || manifest.Schema != 1 || len(manifest.Videos) > 2 || len(manifest.Videos) != len(manifest.Workspace.Tracks) {
		return nil, fmt.Errorf("unsupported project format")
	}
	dir, err := os.MkdirTemp("", "motion-project-import-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	var imported []*Project
	defer func() {
		if err != nil {
			for _, p := range imported {
				folder, _ := s.Folder(p.ID)
				os.RemoveAll(folder)
			}
		}
	}()
	ids := map[string]string{}
	for i, video := range manifest.Videos {
		if ids[video.ID] != "" || video.ID == "" {
			return nil, fmt.Errorf("invalid video identity")
		}
		entry := entries[video.Source]
		if entry == nil {
			return nil, fmt.Errorf("project video missing")
		}
		source := filepath.Join(dir, fmt.Sprintf("%d%s", i, filepath.Ext(video.Source)))
		input, e := entry.Open()
		if e != nil {
			return nil, e
		}
		output, e := os.Create(source)
		if e != nil {
			input.Close()
			return nil, e
		}
		_, e = io.Copy(output, io.LimitReader(input, (256<<20)+1))
		input.Close()
		closeErr := output.Close()
		if e != nil {
			return nil, e
		}
		if closeErr != nil {
			return nil, closeErr
		}
		p, e := s.Import(source, video.Name)
		if e != nil {
			return nil, e
		}
		imported = append(imported, p)
		if video.Width != p.Width || video.Height != p.Height || len(video.Times) != len(p.Times) || video.ZeroFrame < 0 || video.ZeroFrame >= len(p.Times) {
			return nil, fmt.Errorf("project video metadata does not match media")
		}
		for _, sample := range video.Samples {
			if sample.Frame < 0 || sample.Frame >= len(p.Times) {
				return nil, fmt.Errorf("sample outside video")
			}
		}
		for _, anchor := range video.Anchors {
			if anchor.Frame < 0 || anchor.Frame >= len(p.Times) {
				return nil, fmt.Errorf("anchor outside video")
			}
		}
		if video.Settings != nil && (video.Settings.Start < 0 || video.Settings.End < video.Settings.Start || video.Settings.End >= len(p.Times)) {
			return nil, fmt.Errorf("tracking range outside video")
		}
		ids[video.ID] = p.ID
		video.ID, video.Source, video.Times = p.ID, p.Source, p.Times
		video.Comparison = nil
		*p = video
		if e = s.Save(p); e != nil {
			return nil, e
		}
	}
	for i := range manifest.Workspace.Tracks {
		track := &manifest.Workspace.Tracks[i]
		mapped := ids[track.ID]
		if mapped == "" {
			return nil, fmt.Errorf("unknown video in workspace")
		}
		track.ID = mapped
	}
	manifest.Workspace.ID = uuid.NewString()
	if _, err = s.SaveWorkspace(manifest.Workspace.ID, &manifest.Workspace); err != nil {
		return nil, err
	}
	return &manifest.Workspace, nil
}

package web

import "time"

type Entry struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	modified time.Time
}

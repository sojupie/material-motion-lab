.PHONY: build generate frontend test serve
build: generate frontend
	./scripts/go-local.sh build -o bin/ui-motion ./cmd/ui-motion
generate:
	go run github.com/a-h/templ/cmd/templ@v0.3.960 generate -path internal/web
frontend:
	npm run build
test:
	./scripts/go-local.sh test ./...
	npm test
serve: build
	./scripts/run.sh serve

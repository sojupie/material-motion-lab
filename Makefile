.PHONY: build build-static generate frontend test serve
build: build-static
	./scripts/go-local.sh build -o bin/ui-motion ./cmd/ui-motion
build-static: generate frontend
	CGO_ENABLED=0 go run -tags staticweb ./cmd/web-static --out dist
	node scripts/startup-assets.mjs
	node scripts/offline-assets.mjs
	node scripts/compress-assets.mjs
generate:
	go run github.com/a-h/templ/cmd/templ@v0.3.960 generate -path internal/web
frontend:
	npm run build
test:
	./scripts/go-local.sh test ./...
	npm test
serve: build
	./scripts/run.sh serve

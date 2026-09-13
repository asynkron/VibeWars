.PHONY: worktree typecheck test build quality

.DEFAULT_GOAL := quality

worktree:
	@test -n "$(FAKTORIAL_WORKTREE_PATH)" || { \
		echo "FAKTORIAL_WORKTREE_PATH is required" >&2; \
		exit 2; \
	}
	npm --prefix "$(FAKTORIAL_WORKTREE_PATH)" ci

typecheck:
	npm run typecheck

test:
	npm test

build:
	npm run build

quality:
	$(MAKE) typecheck
	$(MAKE) test
	$(MAKE) build

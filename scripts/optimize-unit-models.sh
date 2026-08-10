#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
input_dir="${1:-$repo_root/new-models}"
output_dir="${2:-$repo_root/public/assets/units}"
gltf_transform_package="${GLTF_TRANSFORM_PACKAGE:-@gltf-transform/cli@4.4.2}"
texture_size="${MODEL_TEXTURE_SIZE:-256}"
jpeg_quality="${MODEL_JPEG_QUALITY:-85}"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/vibewars-models.XXXXXX")"

cleanup() {
    rm -rf "$work_dir"
}
trap cleanup EXIT

gltf() {
    npx --yes "$gltf_transform_package" "$@"
}

require_source() {
    if [[ ! -f "$input_dir/$1" ]]; then
        echo "Missing model source: $input_dir/$1" >&2
        exit 1
    fi
}

validate_contract() {
    local model="$1"
    local team_material="$2"
    gltf validate "$model"
    if ! grep -a -q "\"name\":\"$team_material\"" "$model"; then
        echo "Optimized model lost required $team_material material: $model" >&2
        exit 1
    fi
}

optimize_static() {
    local source_name="$1"
    local output_name="$2"
    local team_material="${3:-teamCamo}"
    local stage_dir="$work_dir/${output_name%.glb}"
    mkdir -p "$stage_dir"

    node "$script_dir/repair-non-uv-materials.mjs" \
        "$input_dir/$source_name" "$stage_dir/0-material-fixed.glb"
    gltf resize "$stage_dir/0-material-fixed.glb" "$stage_dir/1-resized.glb" \
        --width "$texture_size" --height "$texture_size"
    gltf jpeg "$stage_dir/1-resized.glb" "$stage_dir/2-jpeg.glb" \
        --formats png --quality "$jpeg_quality"
    gltf weld "$stage_dir/2-jpeg.glb" "$stage_dir/3-welded.glb"
    gltf join "$stage_dir/3-welded.glb" "$stage_dir/4-joined.glb"
    gltf dedup "$stage_dir/4-joined.glb" "$stage_dir/5-deduped.glb"
    gltf prune "$stage_dir/5-deduped.glb" "$work_dir/$output_name"
    validate_contract "$work_dir/$output_name" "$team_material"
}

optimize_nightjar() {
    local source_name="nightjar-attack-helo (5).glb"
    local output_name="nightjar-attack-helo.glb"
    local stage_dir="$work_dir/nightjar-attack-helo"
    mkdir -p "$stage_dir"

    # Some canopy-frame primitives in the source export use a textured
    # material despite having no UVs. Repair that known authoring issue in a
    # reproducible way before running the normal optimization pipeline.
    node "$script_dir/repair-non-uv-materials.mjs" \
        "$input_dir/$source_name" "$stage_dir/0-material-fixed.glb" nightjar

    # Keep PNG rather than converting to JPEG: rotor_blur needs its alpha.
    # Do not join or flatten this model: RotorSystem animates these named
    # nodes independently and the optimization must preserve that contract.
    gltf resize "$stage_dir/0-material-fixed.glb" "$stage_dir/1-resized.glb" \
        --width "$texture_size" --height "$texture_size"
    gltf weld "$stage_dir/1-resized.glb" "$stage_dir/2-welded.glb"
    gltf dedup "$stage_dir/2-welded.glb" "$stage_dir/3-deduped.glb"
    gltf prune "$stage_dir/3-deduped.glb" "$work_dir/$output_name"
    validate_contract "$work_dir/$output_name" "teamCamo"

    for required_name in rotor_upper rotor_lower fan rotor_blur; do
        if ! grep -a -q "$required_name" "$work_dir/$output_name"; then
            echo "Optimized Nightjar lost required rotor name: $required_name" >&2
            exit 1
        fi
    done
}

expected_sources=(
    "bombard-artillery (4).glb"
    "bulwark-heavy-tank (5).glb"
    "halberd-aa-tank (2).glb"
    "lynx-light-ifv (2).glb"
    "nightjar-attack-helo (5).glb"
    "sabre-medium-tank (3).glb"
    "shrike-attack-jet (4).glb"
)

for source_name in "${expected_sources[@]}"; do
    require_source "$source_name"
done

# New exports should never be silently ignored. Adding a GLB requires an
# explicit output mapping and a decision about whether its hierarchy is safe
# to join.
while IFS= read -r source_path; do
    source_name="$(basename "$source_path")"
    known=false
    for expected_name in "${expected_sources[@]}"; do
        if [[ "$source_name" == "$expected_name" ]]; then
            known=true
            break
        fi
    done
    if [[ "$known" != true ]]; then
        echo "Unmapped GLB in new-models: $source_name" >&2
        exit 1
    fi
done < <(find "$input_dir" -maxdepth 1 -type f -name '*.glb' -print)

optimize_static "bombard-artillery (4).glb" "kestrel-bombard-artillery.glb"
optimize_static "bulwark-heavy-tank (5).glb" "bulwark-heavy-tank.glb"
optimize_static "halberd-aa-tank (2).glb" "halberd-aa-tank.glb"
optimize_static "lynx-light-ifv (2).glb" "lynx-light-ifv.glb"
optimize_static "sabre-medium-tank (3).glb" "sabre-medium-tank.glb"
optimize_static "shrike-attack-jet (4).glb" "shrike-attack-jet.glb" "teamCarbon"
optimize_nightjar

mkdir -p "$output_dir"
for optimized_model in "$work_dir"/*.glb; do
    cp "$optimized_model" "$output_dir/$(basename "$optimized_model")"
done

echo "Installed optimized unit models:"
du -h \
    "$output_dir/kestrel-bombard-artillery.glb" \
    "$output_dir/bulwark-heavy-tank.glb" \
    "$output_dir/halberd-aa-tank.glb" \
    "$output_dir/lynx-light-ifv.glb" \
    "$output_dir/sabre-medium-tank.glb" \
    "$output_dir/shrike-attack-jet.glb" \
    "$output_dir/nightjar-attack-helo.glb"

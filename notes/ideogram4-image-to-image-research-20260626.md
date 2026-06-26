# Ideogram 4 Image-to-Image Research - 2026-06-26

Question: Can an existing photo be used as a basis for image generation through the Ideogram 4 model?

Conclusion:

- Hosted Ideogram API supports true image-to-image through Ideogram 4.0 Remix: an initial image plus prompt, with `image_weight` controlling how strongly the output resembles the input.
- Hosted API also has edit/inpainting-style endpoints with masks, including legacy Edit.
- Open-weight/local Ideogram 4 is documented and packaged as a text-to-image model. The official open-source inference docs show prompt-only generation.
- The local `ideogram4-mps` runtime currently passes only `caption`, `width`, `height`, `preset`, and `seed` into `generate_image`; there is no init image, mask, or image weight path in generation.
- The local WebUI/Magic Prompt accepts base64 reference images only for caption expansion through a multimodal LLM. This is reference-image-to-caption-to-text-to-image, not true img2img.

Practical options:

1. For real image-to-image: call Ideogram hosted API `/v1/ideogram-v4/remix`.
2. For local-only approximation: use a multimodal captioner to convert the source photo into an Ideogram 4 JSON caption, then generate locally with the MLX model.
3. For identity/style consistency across many outputs: combine local reference-image captioning with LoRA, curated prompts, and seed sweeps; this still will not preserve pixels or exact identity like true img2img.

Sources:

- https://developer.ideogram.ai/api-reference/api-reference/remix-v4
- https://developer.ideogram.ai/api-reference/api-reference/edit
- https://huggingface.co/ideogram-ai/ideogram-4-nf4
- https://raw.githubusercontent.com/ideogram-oss/ideogram4/main/docs/inference.md

Local evidence:

- `README.md` says `/api/magic-prompt` accepts text plus base64 reference images for caption expansion.
- `server/magic_prompt.py` sends reference images to the LLM and returns a JSON caption.
- `server/main.py` and `server/model_daemon.py` generation request schemas accept caption and generation settings, not source images.
- `server/mlx_runtime.py` calls `self._model.generate_image(seed, prompt, width, height, preset, ...)` with no init image or mask.

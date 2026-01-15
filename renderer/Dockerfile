# Kometa Preview Renderer
# Based on official Kometa image to use Kometa's overlay rendering pipeline
ARG KOMETA_IMAGE_TAG=v2.2.2

FROM kometateam/kometa:${KOMETA_IMAGE_TAG}

# Install additional dependencies for preview mode
USER root

# Create preview directories
# /preview/assets is the overlay asset cache - mount as a volume to persist between restarts
# Example: docker run -v kometa-assets:/preview/assets ...
RUN mkdir -p /preview /preview/assets /jobs

# Copy all preview/renderer Python modules
# Note: When build context is repo root, need renderer/ prefix
COPY renderer/*.py /preview/
RUN chmod +x /preview/preview_entrypoint.py

# Copy committed overlay assets (from repository)
# These assets ship with the image to avoid download delays
COPY assets /app/assets

# Set working directory
WORKDIR /

# Declare volume for asset cache persistence
# Users should mount a named volume or bind mount to persist cached overlay assets
VOLUME ["/preview/assets"]

# Override entrypoint for preview mode
ENTRYPOINT ["python3", "/preview/preview_entrypoint.py"]

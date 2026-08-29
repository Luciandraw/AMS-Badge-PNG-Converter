# AMS Badge PNG Converter

A zero-build, client-side PNG → MakerWorld SVG converter for GitHub Pages.

The page reduces a PNG to a maximum of four colors, orders them from darkest to
lightest, creates SVG groups named `color_1` through `color_4`, and normalizes
the result to `viewBox="0 0 100 100"`. The lightest detected color becomes
`color_4`, matching the default backing material in AMS Badge Customizer.

Images are processed locally in the browser and are never uploaded to a server.

For PNGs with gradients or many source colors, choose **Manual thresholds** and
adjust the Shadows, Midtones, and Highlights boundaries. The preview and the
four exported SVG groups update immediately. **Reset thresholds** restores the
automatically suggested boundaries for the current image.

## Run locally

You can open `index.html` directly. To reproduce GitHub Pages behavior, serve
this folder with any static HTTP server.

## Publish with GitHub Pages

1. Create a new empty GitHub repository.
2. Upload every file from this folder to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select `main`, choose `/ (root)`, and click **Save**.

The published URL will look like `https://USERNAME.github.io/REPOSITORY/`.

For fully reliable social previews, replace the relative `og.png` values in
`index.html` with the absolute GitHub Pages image URL after publishing.

## Input recommendations

- PNG with transparency or a clean, flat background;
- high-contrast artwork with four or fewer intended colors;
- files up to 10 MB;
- use Manual thresholds when a gradient or many source colors need controlled
  reduction to four printable regions.

Large images are sampled to a maximum raster dimension of 320 pixels before
vector construction. This keeps the generated SVG manageable for OpenSCAD and
is appropriate for a 17 mm badge.

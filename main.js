const WebXRPolyfill = require("webxr-polyfill");
const { mat4 } = require("gl-matrix");
const bunny = require("bunny");
const normals = require("normals");
const center = require("geo-center");
const REGL = require("regl");

// Search for _gl in this file to see where I've needed to hack things a little to get WebXR to work.

async function main() {
  // Make and grab our elements.
  document.body.innerHTML = `
    <canvas id="render-canvas"></canvas>
    <br>
    <button id="enter-xr" style="display: none">Enter VR</button>
    <span id="no-xr" style="display: none">WebXR not supported :(</span>
  `;

  const canvas = document.getElementById("render-canvas");
  const enterButton = document.getElementById("enter-xr");
  const noXR = document.getElementById("no-xr");

  // Initialize the polyfill.
  const polyfill = new WebXRPolyfill();

  // Create our session state variables.
  let xrSession = null;
  let xrReferenceSpace = null;

  // If WebXR is supported, set up the button. Otherwise, display a no support message.
  async function checkForXRSupport() {
    const supported = await navigator.xr.isSessionSupported("immersive-vr");
    if (supported) {
      enterButton.style.display = "inline-block";
      enterButton.addEventListener("click", onClickEnterVR);
    } else {
      noXR.style.display = "inline-block";
    }
  }

  navigator.xr.addEventListener("devicechange", checkForXRSupport);
  checkForXRSupport();

  // If someone clicks the button, start the session.
  async function onClickEnterVR() {
    xrSession = await navigator.xr.requestSession("immersive-vr");
    xrReferenceSpace = await xrSession.requestReferenceSpace("local");

    // **** First hack to get this to work with regl:
    await regl._gl.makeXRCompatible();

    xrSession.updateRenderState({
      baseLayer: new XRWebGLLayer(xrSession, regl._gl)
    });
    xrSession.addEventListener("end", () => {
      xrSession = null;
      window.requestAnimationFrame(onDrawFrame);
    });
    xrSession.requestAnimationFrame(onDrawFrame);
  }

  // Calculate normals and center the bunny.
  bunny.normals = normals.vertexNormals(bunny.cells, bunny.positions);
  bunny.positions = center(bunny.positions);

  // Create the regl context.
  const regl = REGL({
    canvas: canvas
  });

  // Create a simple command to render the bunny.
  const cmdRender = regl({
    vert: `
      precision highp float;
      attribute vec3 position, normal;
      uniform mat4 model, view, projection;
      varying vec3 vNormal;
      void main() {
        gl_Position = projection * view * model * vec4(position, 1);
        vNormal = normal;
      }`,
    frag: `
      precision highp float;
      varying vec3 vNormal;
      void main() {
        gl_FragColor = vec4(vNormal * 0.5 + 0.5, 1);
      }`,
    attributes: {
      position: bunny.positions,
      normal: bunny.normals
    },
    uniforms: {
      model: regl.prop("model"),
      view: regl.prop("view"),
      projection: regl.prop("projection")
    },
    viewport: regl.prop("viewport"),
    elements: bunny.cells
  });

  // Handle an animation frame, either from window.raf or xrSession.raf.
  function onDrawFrame(timestamp, xrFrame) {
    // Create and animate the model matrix.
    const model = mat4.create();
    mat4.translate(model, model, [0, 0, -0.5]);
    mat4.rotateY(model, model, timestamp * 0.001);
    mat4.rotateX(model, model, timestamp * 0.0013);
    mat4.scale(model, model, [0.01, 0.01, 0.01]);
    // Create the projection matrix.
    const projection = mat4.perspective(
      [],
      Math.PI / 2,
      canvas.width / canvas.height,
      0.01,
      100.0
    );

    // If we have the xrSession and xrFrame, render to the provided framebuffer, once per eye.
    if (xrSession && xrFrame) {
      let glLayer = xrSession.renderState.baseLayer;
      let pose = xrFrame.getViewerPose(xrReferenceSpace);
      if (pose) {
        // **** Second hack to get this to work with regl. Bind the framebuffer and clear it before
        // **** rendering to it. Note that this is not a regl framebuffer, it's just a WebGL framebuffer
        // **** ID handed to us by WebXR.
        regl._gl.bindFramebuffer(regl._gl.FRAMEBUFFER, glLayer.framebuffer);
        regl._gl.clearColor(1, 1, 1, 1);
        regl._gl.clear(regl._gl.DEPTH_BUFFER_BIT | regl._gl.COLOR_BUFFER_BIT);

        // Render each eye.
        for (let poseView of pose.views) {
          let viewport = glLayer.getViewport(poseView);
          const viewMatrix = mat4.fromRotationTranslation(
            [],
            [
              poseView.transform.orientation.x,
              poseView.transform.orientation.y,
              poseView.transform.orientation.z,
              poseView.transform.orientation.w
            ],
            [
              poseView.transform.position.x,
              poseView.transform.position.y,
              poseView.transform.position.z
            ]
          );
          mat4.invert(viewMatrix, viewMatrix);
          cmdRender({
            model,
            view: viewMatrix,
            projection: poseView.projectionMatrix,
            viewport
          });
        }
      }
    } else {
      // We don't have the data we need for XR rendering, so we'll just render to the screen instead.
      canvas.width = 300;
      canvas.height = 150;
      const view = mat4.lookAt([], [0, 0, 0], [0, 0, -1], [0, 1, 0]);
      regl.clear({ color: [1, 1, 1, 1], depth: 1 });
      cmdRender({
        model,
        view,
        projection,
        viewport: { x: 0, y: 0, width: canvas.width, height: canvas.height }
      });
    }

    // Request the appropriate animation frame.
    if (xrSession) {
      xrSession.requestAnimationFrame(onDrawFrame);
    } else {
      window.requestAnimationFrame(onDrawFrame);
    }
  }

  // Kick off the render loop.
  onDrawFrame();
}

main();

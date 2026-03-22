/*
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

(function() {
  var Marzipano = window.Marzipano;
  var bowser = window.bowser;
  var screenfull = window.screenfull;
  var data = window.APP_DATA;

  // Grab elements from DOM.
  var panoElement = document.querySelector('#pano');
  var sceneNameElement = document.querySelector('#titleBar .sceneName');
  var sceneListElement = document.querySelector('#sceneList');
  var sceneElements = document.querySelectorAll('#sceneList .scene');
  var sceneListToggleElement = document.querySelector('#sceneListToggle');
  var autorotateToggleElement = document.querySelector('#autorotateToggle');
  var fullscreenToggleElement = document.querySelector('#fullscreenToggle');

  // Detect desktop or mobile mode.
  if (window.matchMedia) {
    var setMode = function() {
      if (mql.matches) {
        document.body.classList.remove('desktop');
        document.body.classList.add('mobile');
      } else {
        document.body.classList.remove('mobile');
        document.body.classList.add('desktop');
      }
    };
    var mql = matchMedia("(max-width: 500px), (max-height: 500px)");
    setMode();
    mql.addListener(setMode);
  } else {
    document.body.classList.add('desktop');
  }

  // Detect whether we are on a touch device.
  document.body.classList.add('no-touch');
  window.addEventListener('touchstart', function() {
    document.body.classList.remove('no-touch');
    document.body.classList.add('touch');
  });

  // Use tooltip fallback mode on IE < 11.
  if (bowser.msie && parseFloat(bowser.version) < 11) {
    document.body.classList.add('tooltip-fallback');
  }

  // Viewer options.
  var viewerOpts = {
    controls: {
      mouseViewMode: data.settings.mouseViewMode
    }
  };

  // Initialize viewer.
  var viewer = new Marzipano.Viewer(panoElement, viewerOpts);

  // Current active scene.
  var currentScene = null;

  // Coords panel.
  var coordsBox = document.createElement('div');
  coordsBox.style.position = 'absolute';
  coordsBox.style.left = '10px';
  coordsBox.style.bottom = '10px';
  coordsBox.style.zIndex = '99999';
  coordsBox.style.padding = '6px 10px';
  coordsBox.style.background = 'rgba(0,0,0,0.35)';
  coordsBox.style.color = 'rgba(255,255,255,0.7)';
  coordsBox.style.fontFamily = 'monospace';
  coordsBox.style.fontSize = '11px';
  coordsBox.style.borderRadius = '4px';
  coordsBox.style.pointerEvents = 'none';
  coordsBox.style.whiteSpace = 'nowrap';
  coordsBox.style.display = 'none';
  coordsBox.textContent = 'yaw: --- | pitch: ---';
  document.body.appendChild(coordsBox);

  function getCoordsFromMouseEvent(e) {
    if (!currentScene || !currentScene.view) {
      return null;
    }

    var rect = panoElement.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    try {
      return currentScene.view.screenToCoordinates({ x: x, y: y }, { width: rect.width, height: rect.height });
    } catch (err) {
      try {
        return currentScene.view.screenToCoordinates({ x: x, y: y }, rect);
      } catch (err2) {
        return null;
      }
    }
  }

  panoElement.addEventListener('mousemove', function(e) {
    var coords = getCoordsFromMouseEvent(e);
    if (!coords) {
      coordsBox.textContent = 'yaw: --- | pitch: ---';
      return;
    }

    coordsBox.textContent =
      'yaw: ' + coords.yaw.toFixed(6) +
      ' | pitch: ' + coords.pitch.toFixed(6);
  });

  panoElement.addEventListener('click', function(e) {
    var coords = getCoordsFromMouseEvent(e);
    if (!coords) {
      return;
    }

    coordsBox.textContent =
      'yaw: ' + coords.yaw.toFixed(6) +
      ' | pitch: ' + coords.pitch.toFixed(6);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(
        'yaw: ' + coords.yaw.toFixed(6) + ', pitch: ' + coords.pitch.toFixed(6)
      ).catch(function() {});
    }
  });

  // Create scenes.
  var scenes = data.scenes.map(function(data) {
    var urlPrefix = "tiles";
    var source = Marzipano.ImageUrlSource.fromString(
      urlPrefix + "/" + data.id + "/{z}/{f}/{y}/{x}.jpg",
      { cubeMapPreviewUrl: urlPrefix + "/" + data.id + "/preview.jpg" }
    );
    var geometry = new Marzipano.CubeGeometry(data.levels);

    var limiter = Marzipano.RectilinearView.limit.traditional(
      data.faceSize,
      100 * Math.PI / 180,
      120 * Math.PI / 180
    );
    var view = new Marzipano.RectilinearView(data.initialViewParameters, limiter);

    var scene = viewer.createScene({
      source: source,
      geometry: geometry,
      view: view,
      pinFirstLevel: true
    });

    // Create link hotspots.
    data.linkHotspots.forEach(function(hotspot) {
      var element = createLinkHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, {
        yaw: hotspot.yaw,
        pitch: hotspot.pitch
      });
    });

    // Create info hotspots.
    data.infoHotspots.forEach(function(hotspot) {
      var element = createInfoHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, {
        yaw: hotspot.yaw,
        pitch: hotspot.pitch
      });
    });

    return {
      data: data,
      scene: scene,
      view: view
    };
  });

  // Set up autorotate, if enabled.
  var autorotate = Marzipano.autorotate({
    yawSpeed: 0.03,
    targetPitch: 0,
    targetFov: Math.PI / 2
  });

  if (data.settings.autorotateEnabled) {
    autorotateToggleElement.classList.add('enabled');
  }

  // Set handler for autorotate toggle.
  autorotateToggleElement.addEventListener('click', toggleAutorotate);

  // Set up fullscreen mode, if supported.
  if (screenfull.enabled && data.settings.fullscreenButton) {
    document.body.classList.add('fullscreen-enabled');
    fullscreenToggleElement.addEventListener('click', function() {
      screenfull.toggle();
    });
    screenfull.on('change', function() {
      if (screenfull.isFullscreen) {
        fullscreenToggleElement.classList.add('enabled');
      } else {
        fullscreenToggleElement.classList.remove('enabled');
      }
    });
  } else {
    document.body.classList.add('fullscreen-disabled');
  }

  // Set handler for scene list toggle.
  sceneListToggleElement.addEventListener('click', toggleSceneList);

  // Start with the scene list open on desktop.
  if (!document.body.classList.contains('mobile')) {
    showSceneList();
  }

  // Set handler for scene switch.
  scenes.forEach(function(scene) {
    var el = document.querySelector('#sceneList .scene[data-id="' + scene.data.id + '"]');
    el.addEventListener('click', function() {
      switchScene(scene);
      if (document.body.classList.contains('mobile')) {
        hideSceneList();
      }
    });
  });

  // DOM elements for view controls.
  var viewUpElement = document.querySelector('#viewUp');
  var viewDownElement = document.querySelector('#viewDown');
  var viewLeftElement = document.querySelector('#viewLeft');
  var viewRightElement = document.querySelector('#viewRight');
  var viewInElement = document.querySelector('#viewIn');
  var viewOutElement = document.querySelector('#viewOut');

  // Dynamic parameters for controls.
  var velocity = 0.7;
  var friction = 3;
  var keyboardMaxSpeed = 0.06;
  var keyboardResponse = 7.5;
  var keyboardInertia = 1.25;
  var keyboardFovMaxSpeed = 0.038;
  var keyboardFovResponse = 6.2;
  var keyboardFovInertia = 1.15;
  var keyboardResumeDelay = 1200;

  // Associate view controls with elements.
  var controls = viewer.controls();
  controls.registerMethod('upElement', new Marzipano.ElementPressControlMethod(viewUpElement, 'y', -velocity, friction), true);
  controls.registerMethod('downElement', new Marzipano.ElementPressControlMethod(viewDownElement, 'y', velocity, friction), true);
  controls.registerMethod('leftElement', new Marzipano.ElementPressControlMethod(viewLeftElement, 'x', -velocity, friction), true);
  controls.registerMethod('rightElement', new Marzipano.ElementPressControlMethod(viewRightElement, 'x', velocity, friction), true);
  controls.registerMethod('inElement', new Marzipano.ElementPressControlMethod(viewInElement, 'zoom', -velocity, friction), true);
  controls.registerMethod('outElement', new Marzipano.ElementPressControlMethod(viewOutElement, 'zoom', velocity, friction), true);

  var keyboardState = {
    left: false,
    right: false,
    up: false,
    down: false,
    zoomIn: false,
    zoomOut: false,
    yawVelocity: 0,
    pitchVelocity: 0,
    fovVelocity: 0,
    lastFrameTime: null,
    resumeTimeoutId: null
  };

  function queueAutorotateResume() {
    if (keyboardState.resumeTimeoutId) {
      clearTimeout(keyboardState.resumeTimeoutId);
    }
    keyboardState.resumeTimeoutId = window.setTimeout(function() {
      keyboardState.resumeTimeoutId = null;
      if (!keyboardState.left && !keyboardState.right && !keyboardState.up && !keyboardState.down && !keyboardState.zoomIn && !keyboardState.zoomOut) {
        startAutorotate();
      }
    }, keyboardResumeDelay);
  }

  function cancelAutorotateResume() {
    if (!keyboardState.resumeTimeoutId) {
      return;
    }
    clearTimeout(keyboardState.resumeTimeoutId);
    keyboardState.resumeTimeoutId = null;
  }

  function updateKeyboardView(frameTime) {
    if (keyboardState.lastFrameTime == null) {
      keyboardState.lastFrameTime = frameTime;
    }

    var deltaSeconds = (frameTime - keyboardState.lastFrameTime) / 1000;
    keyboardState.lastFrameTime = frameTime;

    if (deltaSeconds > 0.05) {
      deltaSeconds = 0.05;
    }

    var yawDirection = 0;
    var pitchDirection = 0;
    var fovDirection = 0;

    if (keyboardState.left) {
      yawDirection -= 1;
    }
    if (keyboardState.right) {
      yawDirection += 1;
    }
    if (keyboardState.up) {
      pitchDirection -= 1;
    }
    if (keyboardState.down) {
      pitchDirection += 1;
    }
    if (keyboardState.zoomIn) {
      fovDirection -= 1;
    }
    if (keyboardState.zoomOut) {
      fovDirection += 1;
    }

    var yawTargetVelocity = yawDirection * keyboardMaxSpeed;
    var pitchTargetVelocity = pitchDirection * keyboardMaxSpeed;
    var fovTargetVelocity = fovDirection * keyboardFovMaxSpeed;

    var viewBlend = 1 - Math.exp(-(yawDirection !== 0 || pitchDirection !== 0 ? keyboardResponse : keyboardInertia) * deltaSeconds);
    var fovBlend = 1 - Math.exp(-(fovDirection !== 0 ? keyboardFovResponse : keyboardFovInertia) * deltaSeconds);

    keyboardState.yawVelocity += (yawTargetVelocity - keyboardState.yawVelocity) * viewBlend;
    keyboardState.pitchVelocity += (pitchTargetVelocity - keyboardState.pitchVelocity) * viewBlend;
    keyboardState.fovVelocity += (fovTargetVelocity - keyboardState.fovVelocity) * fovBlend;

    if (currentScene && (Math.abs(keyboardState.yawVelocity) > 0.0001 || Math.abs(keyboardState.pitchVelocity) > 0.0001 || Math.abs(keyboardState.fovVelocity) > 0.0001)) {
      var viewParameters = currentScene.view.parameters();
      currentScene.view.setParameters({
        yaw: viewParameters.yaw + keyboardState.yawVelocity * deltaSeconds,
        pitch: viewParameters.pitch + keyboardState.pitchVelocity * deltaSeconds,
        fov: viewParameters.fov + keyboardState.fovVelocity * deltaSeconds
      });
    }

    window.requestAnimationFrame(updateKeyboardView);
  }

  function setKeyboardDirection(keyCode, isPressed) {
    var handled = true;
    var changed = false;

    switch (keyCode) {
      case 37:
        changed = keyboardState.left !== isPressed;
        keyboardState.left = isPressed;
        break;
      case 38:
        changed = keyboardState.up !== isPressed;
        keyboardState.up = isPressed;
        break;
      case 39:
        changed = keyboardState.right !== isPressed;
        keyboardState.right = isPressed;
        break;
      case 40:
        changed = keyboardState.down !== isPressed;
        keyboardState.down = isPressed;
        break;
      case 107:
      case 187:
        changed = keyboardState.zoomIn !== isPressed;
        keyboardState.zoomIn = isPressed;
        break;
      case 109:
      case 173:
      case 189:
        changed = keyboardState.zoomOut !== isPressed;
        keyboardState.zoomOut = isPressed;
        break;
      default:
        handled = false;
        break;
    }

    if (!handled) {
      return false;
    }

    if (!changed) {
      return true;
    }

    if (isPressed) {
      cancelAutorotateResume();
      stopAutorotate();
    } else {
      queueAutorotateResume();
    }

    return true;
  }

  window.addEventListener('keydown', function(event) {
    if (event.repeat) {
      if (event.keyCode >= 37 && event.keyCode <= 40 || event.keyCode === 107 || event.keyCode === 109 || event.keyCode === 173 || event.keyCode === 187 || event.keyCode === 189) {
        event.preventDefault();
      }
      return;
    }
    if (!setKeyboardDirection(event.keyCode, true)) {
      return;
    }
    event.preventDefault();
  });

  window.addEventListener('keyup', function(event) {
    if (!setKeyboardDirection(event.keyCode, false)) {
      return;
    }
    event.preventDefault();
  });

  window.addEventListener('blur', function() {
    keyboardState.left = false;
    keyboardState.right = false;
    keyboardState.up = false;
    keyboardState.down = false;
    keyboardState.zoomIn = false;
    keyboardState.zoomOut = false;
    queueAutorotateResume();
  });

  window.requestAnimationFrame(updateKeyboardView);

  function sanitize(s) {
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;');
  }

  function switchScene(scene) {
    currentScene = scene;
    stopAutorotate();
    scene.view.setParameters(scene.data.initialViewParameters);
    scene.scene.switchTo();
    startAutorotate();
    updateSceneName(scene);
    updateSceneList(scene);
  }

  function updateSceneName(scene) {
    sceneNameElement.innerHTML = sanitize(scene.data.name);
  }

  function updateSceneList(scene) {
    for (var i = 0; i < sceneElements.length; i++) {
      var el = sceneElements[i];
      if (el.getAttribute('data-id') === scene.data.id) {
        el.classList.add('current');
      } else {
        el.classList.remove('current');
      }
    }
  }

  function showSceneList() {
    sceneListElement.classList.add('enabled');
    sceneListToggleElement.classList.add('enabled');
  }

  function hideSceneList() {
    sceneListElement.classList.remove('enabled');
    sceneListToggleElement.classList.remove('enabled');
  }

  function toggleSceneList() {
    sceneListElement.classList.toggle('enabled');
    sceneListToggleElement.classList.toggle('enabled');
  }

  function startAutorotate() {
    if (!autorotateToggleElement.classList.contains('enabled')) {
      return;
    }
    viewer.startMovement(autorotate);
    viewer.setIdleMovement(3000, autorotate);
  }

  function stopAutorotate() {
    viewer.stopMovement();
    viewer.setIdleMovement(Infinity);
  }

  function toggleAutorotate() {
    if (autorotateToggleElement.classList.contains('enabled')) {
      autorotateToggleElement.classList.remove('enabled');
      stopAutorotate();
    } else {
      autorotateToggleElement.classList.add('enabled');
      startAutorotate();
    }
  }

  function createLinkHotspotElement(hotspot) {
    // Create wrapper element to hold icon and tooltip.
    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('link-hotspot');

    // Create image element.
    var icon = document.createElement('img');
    icon.src = 'img/link.png';
    icon.classList.add('link-hotspot-icon');

    // Set rotation transform.
    var transformProperties = ['-ms-transform', '-webkit-transform', 'transform'];
    for (var i = 0; i < transformProperties.length; i++) {
      var property = transformProperties[i];
      icon.style[property] = 'rotate(' + hotspot.rotation + 'rad)';
    }

    // Add click event handler.
    wrapper.addEventListener('click', function() {
      switchScene(findSceneById(hotspot.target));
    });

    // Prevent touch and scroll events from reaching the parent element.
    stopTouchAndScrollEventPropagation(wrapper);

    // Create tooltip element.
    var tooltip = document.createElement('div');
    tooltip.classList.add('hotspot-tooltip');
    tooltip.classList.add('link-hotspot-tooltip');
    tooltip.innerHTML = findSceneDataById(hotspot.target).name;

    wrapper.appendChild(icon);
    wrapper.appendChild(tooltip);

    return wrapper;
  }

  function createInfoHotspotElement(hotspot) {
    // Create wrapper element to hold icon and tooltip.
    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('info-hotspot');

    // Create hotspot/tooltip header.
    var header = document.createElement('div');
    header.classList.add('info-hotspot-header');

    // Create image element.
    var iconWrapper = document.createElement('div');
    iconWrapper.classList.add('info-hotspot-icon-wrapper');
    var icon = document.createElement('img');
    icon.src = 'img/info.png';
    icon.classList.add('info-hotspot-icon');
    iconWrapper.appendChild(icon);

    // Create title element.
    var titleWrapper = document.createElement('div');
    titleWrapper.classList.add('info-hotspot-title-wrapper');
    var title = document.createElement('div');
    title.classList.add('info-hotspot-title');
    title.innerHTML = hotspot.title;
    titleWrapper.appendChild(title);

    // Create close element.
    var closeWrapper = document.createElement('div');
    closeWrapper.classList.add('info-hotspot-close-wrapper');
    var closeIcon = document.createElement('img');
    closeIcon.src = 'img/close.png';
    closeIcon.classList.add('info-hotspot-close-icon');
    closeWrapper.appendChild(closeIcon);

    // Construct header element.
    header.appendChild(iconWrapper);
    header.appendChild(titleWrapper);
    header.appendChild(closeWrapper);

    // Create text element.
    var text = document.createElement('div');
    text.classList.add('info-hotspot-text');
    text.innerHTML = hotspot.text;

    // Place header and text into wrapper element.
    wrapper.appendChild(header);
    wrapper.appendChild(text);

    // Create a modal for the hotspot content to appear on mobile mode.
    var modal = document.createElement('div');
    modal.innerHTML = wrapper.innerHTML;
    modal.classList.add('info-hotspot-modal');
    document.body.appendChild(modal);

    var toggle = function() {
      wrapper.classList.toggle('visible');
      modal.classList.toggle('visible');
    };

    // Show content when hotspot is clicked.
    wrapper.querySelector('.info-hotspot-header').addEventListener('click', toggle);

    // Hide content when close icon is clicked.
    modal.querySelector('.info-hotspot-close-wrapper').addEventListener('click', toggle);

    // Prevent touch and scroll events from reaching the parent element.
    stopTouchAndScrollEventPropagation(wrapper);

    return wrapper;
  }

  // Prevent touch and scroll events from reaching the parent element.
  function stopTouchAndScrollEventPropagation(element) {
    var eventList = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'mousewheel'];
    for (var i = 0; i < eventList.length; i++) {
      element.addEventListener(eventList[i], function(event) {
        event.stopPropagation();
      });
    }
  }

  function findSceneById(id) {
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i].data.id === id) {
        return scenes[i];
      }
    }
    return null;
  }

  function findSceneDataById(id) {
    for (var i = 0; i < data.scenes.length; i++) {
      if (data.scenes[i].id === id) {
        return data.scenes[i];
      }
    }
    return null;
  }

  // Display the initial scene.
  switchScene(scenes[0]);

})();

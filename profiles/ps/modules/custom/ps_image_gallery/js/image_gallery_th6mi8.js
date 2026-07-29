/**
 * @file
 * Defines behavior for an image gallery.
 *
 * The auto-transition code is largely grabbed as-is from ps_core/ps_slider.js.
 */

(function ($, Drupal, once) {
  'use strict';

  /**
   * Resolves a lazy-loading image URL read from a data attribute.
   *
   * The URL is parsed so that only http and https URLs are ever assigned, and
   * every other scheme (javascript:, data:, vbscript:, ...) is rejected.
   * Parsing also normalises away the whitespace and control characters that
   * browsers ignore when reading a scheme, so a scheme with a tab or newline
   * inside it cannot slip past.
   *
   * @param {string} url
   *   The candidate URL, absolute or relative to the current document.
   *
   * @return {?string}
   *   The resolved absolute URL, or null when it is not safe to assign.
   */
  function resolveImageUrl(url) {
    let parsed;
    try {
      parsed = new URL(url, window.location.href);
    }
    catch (e) {
      // Not a URL we can make sense of, so refuse to assign it.
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  }

  /**
   * Validates a lazy-loading srcset value read from a data attribute.
   *
   * Each comma separated candidate is resolved whole, descriptor included, so
   * that a scheme split across whitespace cannot hide from the check.
   *
   * @param {string} srcSet
   *   The candidate srcset, a comma separated list of URL/descriptor pairs.
   *
   * @return {boolean}
   *   TRUE when every candidate in the set is safe to assign.
   */
  function isValidImageSrcSet(srcSet) {
    return srcSet.split(',').every(function (candidate) {
      return resolveImageUrl(candidate) !== null;
    });
  }

  Drupal.behaviors.ps_image_gallery = {
    attach: function (context, settings) {
      $(once('ps-image-gallery', '.ps-image-gallery', context)).each(function () {
        let $gallery = $(this);
        let $images = $gallery.find('.image');

        const $controls = $gallery.find('.ps-image-gallery-controls');

        // Check if the user agent prefers reduced motion.
        let prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // When true, slides auto transition after a period of time.
        let autoTransitionEnabled = false;
        let autoTransitionManual = false;

        // When true, auto transition will stop, but the slider will remain in a
        // "playing" state (the play/stop button will still be on "play").
        let autoTransitionSuspended = false;

        // Controls how fast the slides move. Can be controlled via a data attr.
        let autoTransitionTime = 6000;

        if ($gallery.data('transition-time')) {
          autoTransitionTime = parseInt($gallery.data('transition-time')) * 1000;
        }

        // Stores the auto transition timer.
        let timer;

        // Drupal's states functionality does not zero out auto start hidden
        // field values, so need to check both values here.
        if ($gallery.data('auto-transition') === 1 && $gallery.data('auto-start') === 1) {
          autoTransitionEnabled = true;
        }

        // Tracks the index of the current active image.
        let currentImageIndex = 0;

        // Get the previous index from the reference provided.
        let getPrevIndex = function (referenceIndex) {
          let newIndex = referenceIndex - 1;
          if (newIndex < 0) {
            newIndex = $images.length - 1;
          }
          return newIndex;
        };

        // Get the next index from the reference provided.
        let getNextIndex = function (referenceIndex) {
          let newIndex = referenceIndex + 1;
          if (newIndex === $images.length) {
            newIndex = 0;
          }
          return newIndex;
        };

        // Loads the image by checking if it has the image src in data attributes, and if so,
        // move them to the normal non-data versions. This will force the browser to load them.
        let preLoadImage = function (index) {
          let $imageElement = $images.eq(index).find('img');
          if ($imageElement.length) {
            let img = $imageElement[0];
            let dataSrcset = $imageElement.attr('data-srcset');
            let dataSrc = $imageElement.attr('data-src');
            if (dataSrc) {
              if (dataSrcset && isValidImageSrcSet(dataSrcset)) {
                img.srcset = dataSrcset;
              }
              if (dataSrcset) {
                $imageElement.removeAttr('data-srcset');
              }
              // Assign the resolved URL rather than the raw attribute value,
              // so only a URL that parsed as http(s) can reach src.
              const resolvedSrc = resolveImageUrl(dataSrc);
              if (resolvedSrc) {
                img.src = resolvedSrc;
              }
              $imageElement.removeAttr('data-src');
              // Activate the IE11 shim that adds a fallback for object-fit
              // positioning.
              objectFitImages(img);
            }
          }
        };

        // Load the first three images, anticipating that the user will browse to them.
        preLoadImage(0);
        preLoadImage(1);
        preLoadImage(2);
        const cropToFit = $gallery.hasClass('crop-to-fit');

        // Show a new image.
        let showImage = function (newCurrentIndex, announceChange) {
          // Reset state of all images as we prepare to assign the new classes.
          $images
            .removeClass('current')
            .attr('aria-hidden', 'true')
            .attr('tabindex', '-1')
            .find('a')
            .attr('tabindex', '-1');;

          $images.eq(newCurrentIndex)
            .addClass('current')
            .removeAttr('aria-hidden')
            .attr('tabindex', 0)
            .find('a').not('[aria-hidden]')
            .removeAttr('tabindex');

          // Update current image indiciator.
          if ($gallery.find('.number-indicator').length) {
            $gallery.find('.number-indicator .current').text(newCurrentIndex + 1);
          }

          if (announceChange) {
            window.setTimeout(function() {
              Drupal.announce(`Slide ${newCurrentIndex + 1}`);
            }, 500, newCurrentIndex);
          };

          currentImageIndex = newCurrentIndex;
        };

        let nextImage = function (announceChange = false) {
          showImage(getNextIndex(currentImageIndex), announceChange);

          // Preload the next two images.
          let nextIndex = getNextIndex(currentImageIndex);
          let nextNextIndex = getNextIndex(nextIndex);
          preLoadImage(nextIndex);
          preLoadImage(nextNextIndex);

          if (autoTransitionEnabled && !autoTransitionSuspended) {
            if (timer) {
              clearTimeout(timer);
            }
            timer = setTimeout(nextImage, autoTransitionTime);
          }
        };

        let prevImage = function (announceChange = false) {
          showImage(getPrevIndex(currentImageIndex), announceChange);

          // Preload the prev two images.
          let prevIndex = getPrevIndex(currentImageIndex);
          let prevPrevIndex = getPrevIndex(prevIndex);
          preLoadImage(prevIndex);
          preLoadImage(prevPrevIndex);
        };

        // Disables auto transitions without toggling the play/stop button.
        let suspendAutoTransition = function () {
          if (timer) {
            clearTimeout(timer);
          }

          autoTransitionSuspended = true;
        };

        // Re-enables auto transitions, assuming that it was already enabled.
        let unsuspendAutoTransition = function () {
          autoTransitionSuspended = false;

          // Only re-eanble the auto transitions if it was already set
          // to be enabled.
          if (autoTransitionEnabled) {
            if (timer) {
              clearTimeout(timer);
            }
            timer = setTimeout(nextImage, autoTransitionTime);
          }
        };

        let startAutoTransition = function () {
          autoTransitionSuspended = false;
          autoTransitionEnabled = true;

          if (timer) {
            clearTimeout(timer);
          }
          timer = setTimeout(nextImage, autoTransitionTime);

          $gallery.find('.start-stop-button')
            .attr('data-action', 'stop')
            .attr('aria-label', 'Pause carousel');
          $gallery.find('.start-stop-icon').text('￭');
        };

        let stopAutoTransition = function () {
          if (!autoTransitionEnabled) {
            return;
          }

          autoTransitionSuspended = false;
          autoTransitionEnabled = false;

          if (timer) {
            clearTimeout(timer);
          }

          $gallery.find('.start-stop-button')
            .attr('data-action', 'start')
            .attr('aria-label', 'Start carousel');
          $gallery.find('.start-stop-icon').text('▶');
        };

        // Remove hidden links from tab index.
        $gallery.find('li[aria-hidden] a').not('[aria-hidden]').attr('tabindex', '-1');

        // Enable auto transition, only if the client doesn't prefer reduced
        // motion.
        if (autoTransitionEnabled && !prefersReducedMotion) {
          startAutoTransition();
        }

        // Add event handlers to the next/prev controls.
        $('.btn-prev', this).on('click', function () {
          prevImage(true);
        });
        $('.btn-next', this).on('click', function () {
          nextImage(true);
        });

        // Add event handler for starting/stopping auto transitions.
        if ($gallery.find('.start-stop-button').length) {
          $gallery.find('.start-stop-button').on('click', function () {
            let action = $(this).attr('data-action');
            if (action === 'stop') {
              autoTransitionManual = false;
              stopAutoTransition();
            }
            else if (action === 'start') {
              autoTransitionManual = true;
              startAutoTransition();
            }
          });
        }

        // When user hovers over any part of the slider, suspend the auto
        // transition to give the user an easy chance at clicking items in the
        // current slide without the slide moving out from under them.
        $images.on('mouseenter', function () {
          suspendAutoTransition();
        });
        $images.on('mouseleave', function () {
          // Possible trigger combinations are: manual auto-transition on, or
          // auto-transition on and reduced-motion off.
          if (autoTransitionSuspended && (autoTransitionManual || (autoTransitionEnabled && !prefersReducedMotion))) {
            unsuspendAutoTransition();
          }
        });

        // When anything within a slide receives keyboard focus then suspend the
        // auto transition to allow user to interact with the elements without
        // them moving out from under them.
        $gallery.on('focusin', function (e) {
          // Don't suspend transition if the user is on the play/pause button.
          // Otherwise it will appear as if the button does nothing.
          if (!$(e.target).hasClass('start-stop-button')) {
            suspendAutoTransition();
          }
        });
        $gallery.on('focusout', function (e) {
          if (autoTransitionSuspended) {
            unsuspendAutoTransition();
          }
        });

        // Here we set the height of each image/slide in the gallery
        // based on the width of the gallery. There's some clever ways
        // to do this with CSS padding based on percentages instead
        // (in fact that's the method we used previously), but we need
        // to set the actual height property to make the CSS object-fit
        // property work correctly for positioning the images.
        let setImageHeights = function () {
          let height = 0;
          let currentWidth = $gallery.width();
          let desiredAspectRatio = $gallery.data('aspect-ratio');
          // Default to 16x9.
          let widthModifer = 0.56;
          if (desiredAspectRatio === '8x3') {
            widthModifer = 0.375;
          } else if (desiredAspectRatio === '3x2') {
            widthModifer = 0.665;
          } else if (desiredAspectRatio === '4x3') {
            widthModifer = 0.75;
          }
          height = currentWidth * widthModifer;

          let contentHeight = 0;

          // Reusing this bit from the columns.js instead to make sure the gallery code is aware of the size
          // Using classes doesn't work properly as the columns function sometimes happens later.
          let gridWidth = $gallery.closest('.layout__region').innerWidth() / parseFloat(psEmSize());
          const isNarrow = gridWidth < 36;

          $images.each(function () {
            const $content = $(this).find('.ps-image-gallery-content');

            $content.css({
              'padding-top': (window.innerWidth > 992 && !isNarrow) ? '1.3rem' : $controls.outerHeight(),
            });
            if ($content.length && $content.outerHeight() > contentHeight) {
              contentHeight = $content.outerHeight();
            }
          });
          const descriptionHeight = $gallery.find('.ps-image-gallery-description').outerHeight() ? $gallery.find('.ps-image-gallery-description').outerHeight() : 0;

          $gallery.find('.image,.images').css('height', height + contentHeight);
          if (!cropToFit) {
            $gallery.find('.image figure').css({'height': height});
          }


          $controls.css({
            'margin-top': (window.innerWidth > 992 && !isNarrow) ? -contentHeight : 0,
            'top': (window.innerWidth > 992 && !isNarrow) ? 0 : height + descriptionHeight
          });

          if (contentHeight > 0) {
            $controls.addClass('ps-image-gallery-controls--with-content');
            $controls.css({
              'min-height': (window.innerWidth > 992 && !isNarrow) ? contentHeight : 'auto'});
          }
        };

        // Here, we find the highest height of all the image captions and
        // set the slider controls container to that height, forcing the slider
        // container to expand vertically so the captions are not hidden.
        let setControlsContainerHeight = function () {
          let heightToSetControlsContainerTo;
          let allCaptionHeights = $gallery.find('figcaption').map(function () {
            return $(this).height();
          });
          heightToSetControlsContainerTo = Math.max.apply(null, allCaptionHeights);
        };

        $(window).on('resize', function () {
          setControlsContainerHeight();
          setImageHeights();
        });

        $(window).on('load', function () {
          setControlsContainerHeight();
          setImageHeights();
        });
      });
    }
  };
})(jQuery, Drupal, once);

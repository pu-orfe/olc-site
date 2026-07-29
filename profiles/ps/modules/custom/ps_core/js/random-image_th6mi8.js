/**
 * @file
 * Contains JS functionality for random image loading for an Image block.
 */

(function ($, Drupal, once) {
  'use strict';

  Drupal.behaviors.random_image = {
    attach: function (context, settings) {

      $(once('ps-random-image', '.block-ps-image', context)).each(function () {
        let $figures = $(this).find('figure.random-image');
        const randomIndex = Math.floor(Math.random() * $figures.length);
        $figures.each(function (index) {
          // Reveal a random image and remove others.
          if (index === randomIndex) {
            $(this).removeClass('invisible')
              .removeAttr('aria-hidden')
              .removeAttr('tabindex');
            let $image = $(this).find('img');
            if ($image.length) {
              let img = $image[0];
              const dataSrc = $image.attr('data-src');
              if (dataSrc) {
                img.src = dataSrc;
              }
              const dataSrcSet = $image.attr('data-srcset');
              if (dataSrcSet) {
                img.srcset = dataSrcSet;
              }
            }
          }
          else {
            $(this).remove();
          }
        });
      });
    }
  };

}(jQuery, Drupal, once));

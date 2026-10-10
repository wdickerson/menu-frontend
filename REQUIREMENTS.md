

## Overview (Version 0)

This repo will hold a React app that helps blind users read restaurant menus through an intuitive slide gesture. It is hosted online, and primarily accessed through a mobile browser.

We will build the web app incrementally. First build a simple React app that displays minimal info on a static screen. There should be no scrolling, as we are going to use swipe gestures very specifically.

## Version 1

The app will be responsible for accepting a photo of a menu, and turning that into structured syntax which can be read to the user. First, simply create a structured JSON representation of the example menu provided in the "assets" directory. We will add runtime menu parsing in a later version, and we will add menu speech in a later version.

## Version 2

We need to implement speech, in order to communicate the menu to blind users. For an initial approach, add two sets of arrow buttons to the static webpage. One set of arrow buttons cycles through the menu sections. The other set cycles through items in the current section. Each button click results in the next item being read aloud. Do not focus too much on the UI of the buttons, as we will replace them later with swipe gestures; the goal of this iteration is to implement speech for the menu.

## Version 3

Now, we are going to work on the touch interface. This site is intended to be used on a smartphone. The controls are this:

- 1 Finger Swipe
-- Down towards bottom of screen progresses forward through Sections
-- Up towards top of screen progresses backwards through Sections

- 1 Finger Tap
-- Re-reads the current Section

-2 Finger Swipe
--Down towards bottom of screen progresses forward through Items within the current section
--Up towards top of screen progresses backwards through Items within the current section

- 2 Finger tap
-- Re-reads the current item

You can remove the buttons now, as we are focusing on the mobile experience.

I have the app running on a smartphone, loading from localhost. I can test for the "feel" of it as you go.

## Version 4

Add some audible indications.

When reaching the end of a collection (ie, the end of the list of sections, or the end of the list of items in a section), do not wrap around and play the first section/item again. Instead, play an audible "thump" sound. Use the Web Audio API to accomplish the "thump". It should be like a low beep, which people will recognize as reaching the end.

If a user is already at the last item and tries to proceed with a tough gesture, the thump should sound.

## Version 5

Just some housekeeping. 

The text on the screen jumps around. I don't want anything jumping around. Simplify things. Remove "Current item". Show the text, but have it confined to a box that can't grow, so that nothing appears to "jump" as I swipe through items.

Also, the Rough and Tumble menu is actually two pages. I now placed two images in a folder. Re-create the JSON file by looking at the images, so the whole menu is available. Use your judgement about what order the sections should be in.

## Version 6

We will not implement a second method of navigating through the menu. The method will be determined with a query parameter called "mode".

There should not be any way in the UI to change modes. Only manually changing the URL in the browser should change the mode.

If "?mode=scroll", that is the version we have built already.

If "?mode=flick", We will implement this new version:

-Flick up on the screen progresses forward through the Section list. Flick down on the screen progresses backwards through the Section list.

-Flick left on the screen progresses forward through Items in the current section. Flick right on the screen progresses backwards through items in the current section.

-All flicks must be with one finger. Two-finger flicks do nothing.

-Tap once with one finger repeats the last utterance, whether it is a Section or an Item.

-Behavior of the "thumps" remain the same. End of list = thump. Try to proceed past the end of the list = thump. Go back once you hear the thump = hear the very last or very first list item.

## Version 7

We need to make the reading speed adjustable.

Possible speeds are 1x, 1.5x, 2x, 2.5x, 3x, 3.5x.

When a user "double taps" (with a single finger), the app should say "Speed [current speed]". If they double tap again before making any other touch gesture, cycle to the next speed and read "Speed [speed]" again. 

Display the speed in small print under the restaurant name, but do not make it adjustable in any other way than the "double tap" behavior described above.

## Version 8

Make "flick" the default mode. If no "mode" query param is present, use flick. If mode is anything but "swipe", use flick.

## Version 9

We want to introduce a restaurant selection mode. Users reach it by holding one finger on the screen for 3 seconds.

Include a "progress bar" at the bottom of the screen to show the "hold for select mode" 3 second wait.

Once in this mode, show a simple page with two restaurants:
Rough & Tumble
Twilight

Each restaurant name is a button, which loads that menu into the app. Once it is selected, return to the currently established behavior with the correct menu.

Maintain a single page app. Do not include the restaurant name in the URL.

This is the only page which is geared towards sighted users. In future revisions, we will make it more user friendly for low-vision users.

I have added images of Twilight's menu. You will need to examine the images and create the required JSON for Twilight's menu.

# Version 10

Use the browser's localStorage to maintain the current restaurant selection and speech rate even on a page reload


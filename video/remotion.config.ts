import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setConcurrency(2);
// the gameplay capture is 2560x1440; we render 1080p (lighter, standard share size)
Config.setOverwriteOutput(true);

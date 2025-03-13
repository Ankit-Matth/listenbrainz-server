import * as React from "react";
import Slider from "rc-slider";
import { countBy, debounce, zipObject } from "lodash";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarCheck } from "@fortawesome/free-solid-svg-icons";
import { startOfDay, format, closestTo, parseISO } from "date-fns";
import { formatReleaseDate, useMediaQuery } from "../utils";
import { SortDirection } from "../FreshReleases";
import { COLOR_LB_BLUE } from "../../../utils/constants";

type ReleaseTimelineProps = {
  releases: Array<FreshReleaseItem>;
  order: string;
  direction: SortDirection;
};

function createMarks(
  releases: Array<FreshReleaseItem>,
  sortDirection: string,
  order: string
) {
  let dataArr: Array<string | JSX.Element> = [];
  let percentArr: Array<number> = [];

  const minReleasesThreshold = Math.floor(releases.length * 0.015);

  if (order === "release_date") {
    let releasesPerDate = countBy(
      releases,
      (item: FreshReleaseItem) => item.release_date
    );

    if (sortDirection === "descend") {
      const reversedReleasesPerDate = Object.keys(releasesPerDate).reverse();
      releasesPerDate = zipObject(
        reversedReleasesPerDate,
        Object.values(releasesPerDate).reverse()
      );
    }

    const firstDate = Object.keys(releasesPerDate)[0];
    const lastDate = Object.keys(releasesPerDate)[
      Object.keys(releasesPerDate).length - 1
    ];

    let totalReleases = 0;
    for (const date in releasesPerDate) {
      totalReleases += releasesPerDate[date];
    }

    const cummulativeMap = new Map<string, number>();
    let cummulativeSum = 0;
    for (const date in releasesPerDate) {
      cummulativeMap.set(date, (100 * cummulativeSum) / totalReleases);
      cummulativeSum += releasesPerDate[date];
    }

    const firstDateStr = format(parseISO(firstDate), "yyyy-MM-dd");
    dataArr.push(formatReleaseDate(firstDateStr));
    percentArr.push(0);

    for (let i = 10; i < 100; i += 10) {
      let date = "";
      let miniDiff = 10;
      cummulativeMap.forEach((value, key) => {
        const currentDiff = Math.abs(value - i);
        if (currentDiff < miniDiff) {
          miniDiff = currentDiff;
          date = key;
        }
      });

      if (date && dataArr[dataArr.length - 1] !== date) {
        const dateStr = format(parseISO(date), "yyyy-MM-dd");
        dataArr.push(formatReleaseDate(dateStr));
        percentArr.push(cummulativeMap.get(date)!);
      }
    }

    const lastDateStr = format(parseISO(lastDate), "yyyy-MM-dd");
    if (dataArr[dataArr.length - 1] !== formatReleaseDate(lastDateStr)) {
      dataArr.push(formatReleaseDate(lastDateStr));
      percentArr.push(cummulativeMap.get(lastDate)!);
    }

    const dates = Object.keys(releasesPerDate).map((date) => parseISO(date));
    const recentDateStr = format(startOfDay(new Date()), "yyyy-MM-dd");
    const closestDateStr = dates.length
      ? format(closestTo(new Date(recentDateStr), dates)!, "yyyy-MM-dd")
      : recentDateStr;

    if (dataArr.includes(formatReleaseDate(closestDateStr))) {
      const index = dataArr.indexOf(formatReleaseDate(closestDateStr));
      dataArr.splice(index, 1);
      percentArr.splice(index, 1);
    }

    const title = closestDateStr === recentDateStr ? "Today" : "Nearest Date";
    dataArr.push(
      <FontAwesomeIcon
        icon={faCalendarCheck}
        size="2xl"
        color={COLOR_LB_BLUE}
        title={title}
      />
    );
    percentArr.push(cummulativeMap.get(closestDateStr)!);

    const sortedData = percentArr
      .map((percent, index) => ({ percent, data: dataArr[index] }))
      .sort((a, b) => a.percent - b.percent);

    dataArr = sortedData.map((item) => item.data);
    percentArr = sortedData.map((item) => item.percent);
  } else if (order === "artist_credit_name") {
    const artistInitialsCount = countBy(releases, (item: FreshReleaseItem) =>
      item.artist_credit_name.charAt(0).toUpperCase()
    );
    const filteredInitials = Object.keys(artistInitialsCount).filter(
      (initial) => artistInitialsCount[initial] >= minReleasesThreshold
    );

    dataArr = filteredInitials.sort();
    percentArr = filteredInitials
      .map((item) => (artistInitialsCount[item] / releases.length) * 100)
      .map((_, index, arr) =>
        arr.slice(0, index + 1).reduce((prev, curr) => prev + curr)
      );

    if (sortDirection === "descend") {
      dataArr.reverse();
      percentArr = percentArr.reverse().map((v) => (v <= 100 ? 100 - v : 0));
    }

    if (percentArr[0] !== 0) {
      percentArr.unshift(0);
      percentArr.pop();
    }
  } else if (order === "release_name") {
    const releaseInitialsCount = countBy(releases, (item: FreshReleaseItem) =>
      item.release_name.charAt(0).toUpperCase()
    );
    const filteredInitials = Object.keys(releaseInitialsCount).filter(
      (initial) => releaseInitialsCount[initial] >= minReleasesThreshold
    );

    dataArr = filteredInitials.sort();
    percentArr = filteredInitials
      .map((item) => (releaseInitialsCount[item] / releases.length) * 100)
      .map((_, index, arr) =>
        arr.slice(0, index + 1).reduce((prev, curr) => prev + curr)
      );

    if (sortDirection === "descend") {
      dataArr.reverse();
      percentArr = percentArr.reverse().map((v) => (v <= 100 ? 100 - v : 0));
    }

    if (percentArr[0] !== 0) {
      percentArr.unshift(0);
      percentArr.pop();
    }
  } else {
    // conutBy gives us an asc-sorted Dict by confidence
    const confidenceInitialsCount = countBy(
      releases,
      (item: FreshReleaseItem) => item?.confidence
    );
    dataArr = Object.keys(confidenceInitialsCount);
    percentArr = Object.values(confidenceInitialsCount)
      .map((item) => (item / releases.length) * 100)
      .map((_, index, arr) =>
        arr.slice(0, index + 1).reduce((prev, curr) => prev + curr)
      );

    if (sortDirection === "descend") {
      dataArr.reverse();
      percentArr = percentArr.reverse().map((v) => (v <= 100 ? 100 - v : 0));
    }

    if (percentArr[0] !== 0) {
      percentArr.unshift(0);
      percentArr.pop();
    }
  }

  return zipObject(percentArr, dataArr);
}

export default function ReleaseTimeline(props: ReleaseTimelineProps) {
  const { releases, order, direction } = props;

  const [currentValue, setCurrentValue] = React.useState<number | number[]>();
  const [marks, setMarks] = React.useState<{ [key: number]: React.ReactNode }>(
    {}
  );

  const screenMd = useMediaQuery("(max-width: 992px)"); // @screen-md

  const changeHandler = React.useCallback((percent: number | number[]) => {
    setCurrentValue(percent);
    const element: HTMLElement | null = document.getElementById(
      "release-card-grids"
    )!;
    const scrollHeight = ((percent as number) / 100) * element.scrollHeight;
    const scrollTo = scrollHeight + element.offsetTop;
    window.scrollTo({ top: scrollTo, behavior: "smooth" });
    return scrollTo;
  }, []);

  React.useEffect(() => {
    setMarks(createMarks(releases, direction, order));
  }, [releases, direction, order]);

  React.useEffect(() => {
    const handleScroll = debounce(() => {
      const container = document.getElementById("release-card-grids");
      if (!container) {
        return;
      }
      const scrollPos =
        ((window.scrollY - container.offsetTop) / container.scrollHeight) * 100;
      setCurrentValue(scrollPos);
    }, 500);

    window.addEventListener("scroll", handleScroll);
    return () => {
      handleScroll.cancel();
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div className="releases-timeline">
      <Slider
        className={screenMd ? "slider-horizontal" : "slider-vertical"}
        vertical={!screenMd}
        reverse={!screenMd}
        included={false}
        marks={marks}
        value={currentValue}
        onChange={changeHandler}
      />
    </div>
  );
}
